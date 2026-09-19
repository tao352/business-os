import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  AskBusinessInput,
  AskBusinessResponse,
  EmbeddingProvider,
} from "@business-os/types";
import { assertSafeReadOnlySql } from "./query-safety-guard.js";
import { generateSqlForQuestion } from "./schema-catalog.js";
import { searchSimilarKnowledge } from "./knowledge-service.js";
import { defaultEmbeddingProvider } from "./embedding-provider.js";

/**
 * Ask Your Business: Natural language query engine combining schema-grounded
 * safe Text-to-SQL execution with vector knowledge base semantic search.
 */
export async function askBusiness(
  context: TenantContext,
  input: AskBusinessInput,
  embeddingProvider: EmbeddingProvider = defaultEmbeddingProvider,
): Promise<AskBusinessResponse> {
  const startTime = Date.now();
  const question = input.question.trim();

  let sqlQuery: string | undefined;
  let dataRows: Record<string, unknown>[] | undefined;
  let answerText = "";

  // 1. Check for Relational Query Plan (Text-to-SQL)
  const sqlPlan = generateSqlForQuestion(question);

  if (sqlPlan) {
    sqlQuery = sqlPlan.sql;
    assertSafeReadOnlySql(sqlQuery);

    dataRows = await withTenantContext(context.organizationId, async (tx) => {
      const res = await tx.query<Record<string, unknown>>(sqlQuery!);
      return res.rows;
    });

    if (sqlPlan.intent === "UNITS_QUERY") {
      const count = dataRows.length;
      answerText =
        count > 0
          ? `يوجد حالياً ${count} وحدة متاحة مطابقة لطلبك في مشروعات الشركة.`
          : "لا توجد وحدات متاحة مطابقة لمعايير البحث الحالية.";
    } else if (sqlPlan.intent === "SALES_QUERY") {
      const topCloser = dataRows[0];
      answerText = topCloser
        ? `أفضل مسؤول مبيعات هو ${topCloser["full_name"]} بإجمالي مبيعات ${topCloser["total_revenue"]} جنيه عبر ${topCloser["contracts_count"]} عقود.`
        : "لا توجد بيانات مبيعات مسجلة بعد للفريق.";
    } else if (sqlPlan.intent === "LEADS_QUERY") {
      const total = dataRows.reduce(
        (sum, r) => sum + Number(r["count"] || 0),
        0,
      );
      answerText = `إجمالي عدد العملاء المحتملين المسجلين في المنظومة هو ${total} ليد موزعين على مراحل البيع.`;
    } else if (sqlPlan.intent === "CONTRACTS_QUERY") {
      const count = dataRows.length;
      answerText = `تم العثور على ${count} عقود بيع مسجلة في قاعدة البيانات.`;
    }
  }

  // 2. Check for Semantic Knowledge Matches (pgvector RAG)
  const knowledgeResults = await searchSimilarKnowledge(
    context,
    {
      query: question,
      limit: 3,
      threshold: 0.05,
    },
    embeddingProvider,
  );

  const knowledgeMatches = knowledgeResults.map((k) => ({
    title: k.documentTitle,
    content: k.content,
    similarity: k.similarity,
  }));

  // 3. Determine Intent Type & Final Synthesis
  let intentType: AskBusinessResponse["intentType"] = "RELATIONAL_QUERY";

  if (sqlQuery && knowledgeMatches.length > 0) {
    intentType = "HYBRID";
    answerText += ` كما تم استرجاع معلومات إضافية من وثائق الشركة: "${knowledgeMatches[0]?.content.substring(0, 150)}..."`;
  } else if (!sqlQuery && knowledgeMatches.length > 0) {
    intentType = "KNOWLEDGE_RETRIEVAL";
    answerText = `بناءً على وثائق ومعلومات الشركة: ${knowledgeMatches[0]?.content}`;
  } else if (!sqlQuery && knowledgeMatches.length === 0) {
    intentType = "RELATIONAL_QUERY";
    answerText =
      "لم أتمكن من العثور على بيانات أو مستندات كافية للإجابة على هذا السؤال بدقة.";
  }

  const executionTimeMs = Date.now() - startTime;

  logger.info(
    {
      organizationId: context.organizationId,
      intentType,
      executionTimeMs,
      rowsCount: dataRows?.length ?? 0,
      knowledgeCount: knowledgeMatches.length,
    },
    "Executed Ask Your Business query",
  );

  return {
    question,
    answerText,
    intentType,
    sqlQuery,
    data: dataRows,
    knowledgeMatches,
    executionTimeMs,
  };
}
