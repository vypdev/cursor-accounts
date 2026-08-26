import type {
  AgentTokenBreakdown,
} from '../../domain/ports/IAgentTrackingRepository';
import {
  normalizeCostSource,
  type CostSource,
} from '../../domain/types/costProvenance';
import { normalizeCostCents } from '../../domain/services/tokenAccounting';
import type { IDatabaseConnectionManager } from '../../domain/ports/IDatabaseConnectionManager';
import type {
  AgentTreeNode,
  ConversationDeltaTotals,
  ConversationTokenTotals,
  TurnEndedRecord,
} from '../types';

/**
 * SQLite read models for agent tracking.
 *
 * This adapter owns query shape and domain mapping. It does not perform
 * writes, migrations, cleanup, or transaction policy.
 */
export class BetterSqliteAgentTrackingReadStore {
  constructor(
    private readonly connectionManager: IDatabaseConnectionManager,
    private readonly dbPath: string
  ) {}

  async getTotalConversationTokens(
    conversationId: string
  ): Promise<ConversationTokenTotals> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    const row = conn.get<{
      total_input: number;
      total_output: number;
      total_cache_read: number;
      total_cache_write: number;
      total: number;
      total_delta: number;
      total_delta_cost: number;
      total_turn_cost: number;
      latest_context_used: number | null;
      latest_context_max: number | null;
      delta_buckets: number;
      agent_count: number;
      started_at: number | null;
      ended_at: number | null;
      models: string | null;
      delta_cost_sources: string | null;
      delta_pricing_snapshot_versions: string | null;
      turn_cost_sources: string | null;
      turn_pricing_snapshot_versions: string | null;
    }>(`
      WITH snapshot_agg AS (
        SELECT
          COALESCE(SUM(te.input_tokens), 0) AS total_input,
          COALESCE(SUM(te.output_tokens), 0) AS total_output,
          COALESCE(SUM(te.cache_read_tokens), 0) AS total_cache_read,
          COALESCE(SUM(te.cache_write_tokens), 0) AS total_cache_write,
          COALESCE(SUM(te.total_tokens), 0) AS total
        FROM agent_turn_ended te
        INNER JOIN agents a ON a.request_id = te.request_id
        WHERE a.conversation_id = ?
      ),
      delta_agg AS (
        SELECT
          COALESCE(SUM(delta_tokens), 0) AS total_delta,
          COALESCE(SUM(delta_cost), 0) AS total_delta_cost,
          MAX(context_used) AS latest_context_used,
          MAX(context_max) AS latest_context_max,
          COUNT(*) AS delta_buckets
          ,GROUP_CONCAT(DISTINCT COALESCE(cost_source, 'unknown')) AS delta_cost_sources
          ,GROUP_CONCAT(DISTINCT pricing_snapshot_version) AS delta_pricing_snapshot_versions
        FROM agent_tokens_delta
        WHERE conversation_id = ?
      ),
      turn_agg AS (
        SELECT
          COALESCE(SUM(total_cents), 0) AS total_turn_cost,
          GROUP_CONCAT(DISTINCT COALESCE(te.cost_source, 'unknown')) AS turn_cost_sources,
          GROUP_CONCAT(DISTINCT te.pricing_snapshot_version) AS turn_pricing_snapshot_versions
        FROM agent_turn_ended te
        INNER JOIN agents a ON a.request_id = te.request_id
        WHERE a.conversation_id = ?
      ),
      agent_agg AS (
        SELECT
          COUNT(*) AS agent_count,
          MIN(started_at) AS started_at,
          MAX(ended_at) AS ended_at,
          GROUP_CONCAT(DISTINCT model_name) AS models
        FROM agents
        WHERE conversation_id = ? AND model_name IS NOT NULL
      )
      SELECT
        s.total_input,
        s.total_output,
        s.total_cache_read,
        s.total_cache_write,
        s.total,
        d.total_delta,
        d.total_delta_cost,
        t.total_turn_cost,
        d.latest_context_used,
        d.latest_context_max,
        d.delta_buckets,
        d.delta_cost_sources,
        d.delta_pricing_snapshot_versions,
        t.turn_cost_sources,
        t.turn_pricing_snapshot_versions,
        a.agent_count,
        a.started_at,
        a.ended_at,
        a.models
      FROM snapshot_agg s, delta_agg d, turn_agg t, agent_agg a
    `, conversationId, conversationId, conversationId, conversationId);

    if (!row) {
      return this.emptyConversationTokenTotals();
    }

    return {
      totalInputTokens: row.total_input,
      totalOutputTokens: row.total_output,
      totalCacheReadTokens: row.total_cache_read,
      totalCacheWriteTokens: row.total_cache_write,
      totalTokens: row.total,
      totalDeltaTokens: row.total_delta,
      totalDeltaCostCents: normalizeCostCents(row.total_delta_cost) ?? 0,
      totalTurnCostCents: normalizeCostCents(row.total_turn_cost) ?? 0,
      latestContextUsedTokens: row.latest_context_used ?? undefined,
      latestContextMaxTokens: row.latest_context_max ?? undefined,
      deltaMinuteBuckets: row.delta_buckets,
      deltaCostSources: this.parseCostSources(row.delta_cost_sources),
      turnCostSources: this.parseCostSources(row.turn_cost_sources),
      pricingSnapshotVersions: this.mergeVersions(
        this.parseVersions(row.delta_pricing_snapshot_versions),
        this.parseVersions(row.turn_pricing_snapshot_versions)
      ),
      agentCount: row.agent_count,
      startedAt: row.started_at ?? 0,
      endedAt: row.ended_at ?? 0,
      models: row.models ? row.models.split(',') : [],
    };
  }

  async getTotalDeltaTokensByConversation(
    conversationId: string
  ): Promise<ConversationDeltaTotals> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    const row = conn.get<{
      total_delta: number;
      total_cost: number;
      delta_buckets: number;
      cost_sources: string | null;
      pricing_snapshot_versions: string | null;
    }>(`
      SELECT
        COALESCE(SUM(delta_tokens), 0) AS total_delta,
        COALESCE(SUM(delta_cost), 0) AS total_cost,
        COUNT(*) AS delta_buckets,
        GROUP_CONCAT(DISTINCT COALESCE(cost_source, 'unknown')) AS cost_sources,
        GROUP_CONCAT(DISTINCT pricing_snapshot_version) AS pricing_snapshot_versions
      FROM agent_tokens_delta
      WHERE conversation_id = ?
    `, conversationId);

    if (!row) {
      return { totalStreamingTokens: 0, totalCostCents: 0, minuteBuckets: 0 };
    }

    return {
      totalStreamingTokens: row.total_delta,
      totalCostCents: normalizeCostCents(row.total_cost) ?? 0,
      minuteBuckets: row.delta_buckets,
      costSources: this.parseCostSources(row.cost_sources),
      pricingSnapshotVersions: this.parseVersions(row.pricing_snapshot_versions),
    };
  }

  async getTurnEndedByConversation(
    conversationId: string
  ): Promise<TurnEndedRecord[]> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    const rows = conn.all<{
      id: number;
      request_id: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number | null;
      cache_write_tokens: number | null;
      total_tokens: number | null;
      total_cents: number | null;
      usage_uuid: string | null;
      recorded_at: number;
      model_name: string | null;
      http_request_id: string | null;
      event_key: string | null;
      cost_source: string | null;
      pricing_snapshot_version: string | null;
    }>(`
      SELECT
        te.id,
        te.request_id,
        te.input_tokens,
        te.output_tokens,
        te.cache_read_tokens,
        te.cache_write_tokens,
        te.total_tokens,
        te.total_cents,
        te.usage_uuid,
        te.recorded_at,
        te.model_name,
        te.http_request_id,
        te.event_key
        ,te.cost_source
        ,te.pricing_snapshot_version
      FROM agent_turn_ended te
      INNER JOIN agents a ON a.request_id = te.request_id
      WHERE a.conversation_id = ?
      ORDER BY te.recorded_at DESC
    `, conversationId);

    return rows.map((row) => {
      const costSource = normalizeCostSource(row.cost_source);
      return {
      id: row.id,
      requestId: row.request_id,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens ?? undefined,
      cacheWriteTokens: row.cache_write_tokens ?? undefined,
      totalTokens: row.total_tokens ?? undefined,
      totalCents: row.total_cents ?? undefined,
      usageUuid: row.usage_uuid ?? undefined,
      recordedAt: row.recorded_at,
      modelName: row.model_name ?? undefined,
      httpRequestId: row.http_request_id ?? undefined,
      eventKey: row.event_key ?? undefined,
      costSource,
      pricingSnapshotVersion:
        costSource === 'model_pricing'
          ? row.pricing_snapshot_version ?? undefined
          : undefined,
      };
    });
  }

  async getAgentTokens(requestId: string): Promise<AgentTokenBreakdown | null> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    const row = conn.get<{
      request_id: string;
      conversation_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      peak_streaming: number | null;
      final_input: number | null;
      final_output: number | null;
      final_cache_read: number | null;
      final_cache_write: number | null;
      final_total: number | null;
    }>(`
      SELECT
        a.request_id,
        a.conversation_id,
        a.parent_request_id,
        a.model_name,
        a.started_at,
        a.ended_at,
        MAX(t.streaming_tokens) AS peak_streaming,
        MAX(t.input_tokens) AS final_input,
        MAX(t.output_tokens) AS final_output,
        MAX(t.cache_read_tokens) AS final_cache_read,
        MAX(t.cache_write_tokens) AS final_cache_write,
        MAX(t.total_tokens) AS final_total
      FROM agents a
      LEFT JOIN agent_tokens t ON t.request_id = a.request_id
      WHERE a.request_id = ?
      GROUP BY a.request_id
    `, requestId);

    if (!row) {
      return null;
    }

    return {
      requestId: row.request_id,
      conversationId: row.conversation_id,
      parentRequestId: row.parent_request_id ?? undefined,
      modelName: row.model_name ?? undefined,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      peakStreamingTokens: row.peak_streaming ?? 0,
      finalInputTokens: row.final_input ?? 0,
      finalOutputTokens: row.final_output ?? 0,
      finalCacheReadTokens: row.final_cache_read ?? 0,
      finalCacheWriteTokens: row.final_cache_write ?? 0,
      finalTotalTokens: row.final_total ?? 0,
    };
  }

  async getAgentTree(conversationId: string): Promise<AgentTreeNode[]> {
    const conn = await this.connectionManager.getConnection(this.dbPath);

    const rows = conn.all<{
      request_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      total_tokens: number;
    }>(`
      SELECT
        a.request_id,
        a.parent_request_id,
        a.model_name,
        a.started_at,
        a.ended_at,
        COALESCE(MAX(t.total_tokens), 0) AS total_tokens
      FROM agents a
      LEFT JOIN agent_tokens t ON t.request_id = a.request_id
      WHERE a.conversation_id = ?
      GROUP BY a.request_id
      ORDER BY a.started_at ASC
    `, conversationId);

    return this.buildAgentTree(rows);
  }

  async getDatabaseSize(): Promise<number> {
    const conn = await this.connectionManager.getConnection(this.dbPath);
    const pageCount = conn.get<{ page_count: number }>('PRAGMA page_count')?.page_count ?? 0;
    const pageSize = conn.get<{ page_size: number }>('PRAGMA page_size')?.page_size ?? 0;

    return +pageCount * +pageSize;
  }

  private emptyConversationTokenTotals(): ConversationTokenTotals {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalTokens: 0,
      totalDeltaTokens: 0,
      totalDeltaCostCents: 0,
      totalTurnCostCents: 0,
      deltaMinuteBuckets: 0,
      agentCount: 0,
      models: [],
      startedAt: 0,
      endedAt: 0,
    };
  }

  private parseCostSources(value: string | null | undefined): CostSource[] | undefined {
    if (!value) return undefined;
    return [...new Set(value.split(',').map((item) => normalizeCostSource(item)))];
  }

  private parseVersions(value: string | null | undefined): string[] | undefined {
    if (!value) return undefined;
    return [...new Set(value.split(',').filter((item) => item.length > 0))];
  }

  private mergeVersions(
    first: readonly string[] | undefined,
    second: readonly string[] | undefined
  ): string[] | undefined {
    const versions = [...new Set([...(first ?? []), ...(second ?? [])])];
    return versions.length > 0 ? versions : undefined;
  }

  private buildAgentTree(
    rows: Array<{
      request_id: string;
      parent_request_id: string | null;
      model_name: string | null;
      started_at: number;
      ended_at: number | null;
      total_tokens: number;
    }>
  ): AgentTreeNode[] {
    const nodes = new Map<string, AgentTreeNode>();

    for (const row of rows) {
      nodes.set(row.request_id, {
        requestId: row.request_id,
        parentRequestId: row.parent_request_id ?? undefined,
        modelName: row.model_name ?? undefined,
        startedAt: row.started_at,
        endedAt: row.ended_at ?? undefined,
        totalTokens: row.total_tokens,
        children: [],
      });
    }

    const roots: AgentTreeNode[] = [];
    for (const node of nodes.values()) {
      if (node.parentRequestId) {
        const parent = nodes.get(node.parentRequestId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}
