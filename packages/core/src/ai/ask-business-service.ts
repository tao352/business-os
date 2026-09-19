import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  AskBusinessInput,
  AskBusinessResponse,
  EmbeddingProvider,
  StructuredQueryIntent,
} from "@business-os/types";
import {
  assertSafeReadOnlySql,
  compileStructuredIntentToSql,
  UnsupportedQueryError,
} from "./query-safety-guard.js";
import { generateSqlForQuestion } from "./schema-catalog.js";
import { searchSimilarKnowledge } from "./knowledge-service.js";
import { defaultEmbeddingProvider } from "./embedding-provider.js";

export interface ExtendedAskBusinessInput extends AskBusinessInput {
  intent?: StructuredQueryIntent;
}

/**
 * Ask Your Business: Secure natural language and structured query engine.
 * Never executes arbitrary AI-generated SQL strings. Strictly routes through
 * validated schema catalogs or approved query compiler AST.
 */
export async function askBusiness(
  context: TenantContext,
  input: ExtendedAskBusinessInput,
  embeddingProvider: EmbeddingProvider = defaultEmbeddingProvider,
): Promise<AskBusinessResponse> {
  const startTime = Date.now();
  const question = input.question.trim();

  let sqlQuery: string | undefined;
  let dataRows: Record<string, unknown>[] | undefined;
  let answerText = "";
  let resolvedIntent: StructuredQueryIntent | undefined = input.intent;

  // 1. If explicit structured query intent is provided, compile via approved compiler
  if (input.intent) {
    try {
      const compiled = compileStructuredIntentToSql(input.intent);
      sqlQuery = compiled.sql;
      assertSafeReadOnlySql(sqlQuery);

      dataRows = await withTenantContext(context.organizationId, async (tx) => {
        const res = await tx.query<Record<string, unknown>>(
          compiled.sql,
          compiled.params,
        );
        return res.rows;
      });

      answerText = `تم استرجاع ${dataRows.length} سجل بنجاح بناءً على معايير الاستعلام المحددة.`;
    } catch (err) {
      if (err instanceof UnsupportedQueryError) {
        return {
          question,
          answerText: `الاستعلام المطلوب غير مدعوم أو يحتوي على حقول غير مصرح بها: ${err.message}`,
          intentType: "UNSUPPORTED_QUERY",
          executionTimeMs: Date.now() - startTime,
        };
      }
      throw err;
    }
  } else {
    // 2. Map known natural language questions via approved schema catalog
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
  }

  // 3. Check for Semantic Knowledge Matches (pgvector RAG)
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

  // 4. Determine Intent Type & Final Synthesis
  let intentType: AskBusinessResponse["intentType"] = "RELATIONAL_QUERY";

  if (sqlQuery && knowledgeMatches.length > 0) {
    intentType = "HYBRID";
    answerText += ` كما تم استرجاع معلومات إضافية من وثائق الشركة: "${knowledgeMatches[0]?.content.substring(0, 150)}..."`;
  } else if (!sqlQuery && knowledgeMatches.length > 0) {
    intentType = "KNOWLEDGE_RETRIEVAL";
    answerText = `بناءً على وثائق ومعلومات الشركة: ${knowledgeMatches[0]?.content}`;
  } else if (!sqlQuery && knowledgeMatches.length === 0) {
    intentType = "UNSUPPORTED_QUERY";
    answerText =
      "الاستعلام غير مدعوم في المسار المباشر، ولم أتمكن من العثور على وثائق كافية للإجابة بأمان.";
  }

  const executionTimeMs = Date.now() - startTime;

  logger.info(
    {
      organizationId: context.organizationId,
      intentType,
      hasSql: !!sqlQuery,
      knowledgeMatchesCount: knowledgeMatches.length,
      durationMs: executionTimeMs,
    },
    "AskBusiness processed query securely",
  );

  return {
    question,
    answerText,
    intentType,
    sqlQuery,
    intent: resolvedIntent,
    data: dataRows,
    knowledgeMatches,
    executionTimeMs,
  };
}
