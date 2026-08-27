import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type { WorkspaceInfo } from '../../application/types/proxyInsights';
import { pickField } from './fieldNormalization';
import {
  definedAgentFields,
  pickRequestId,
  pickStringField,
} from './agentExtractionSupport';

/** Extract workspace identifiers from an agent RPC payload. */
export function extractWorkspaceInfo(
  decoded: Record<string, unknown>
): WorkspaceInfo | null {
  const privateWorkspace = decoded.private_workspace_identifier as
    | Record<string, unknown>
    | undefined;
  const workspaceId =
    pickStringField(decoded, 'workspace_id', 'workspaceId') ??
    (typeof privateWorkspace?.workspace_id === 'string'
      ? privateWorkspace.workspace_id
      : typeof privateWorkspace?.workspaceId === 'string'
        ? privateWorkspace.workspaceId
        : undefined);
  const workspaceRootPath = pickStringField(
    decoded,
    'workspace_root_path',
    'workspaceRootPath'
  );
  const relativeWorkspacePath = pickStringField(
    decoded,
    'relative_workspace_path',
    'relativeWorkspacePath'
  );

  if (!workspaceId && !workspaceRootPath && !relativeWorkspacePath) {
    return null;
  }

  return {
    workspaceId,
    workspaceRootPath,
    relativeWorkspacePath,
  };
}

/** Extract model and session fields from AgentClientMessage.runRequest. */
export function extractAgentRunRequestInfo(
  decoded: Record<string, unknown>
): Partial<AgentSessionInfo> | null {
  const runRequest = pickField(decoded, 'run_request', 'runRequest');
  if (!runRequest || typeof runRequest !== 'object') {
    return null;
  }

  const req = runRequest as Record<string, unknown>;
  const requestedModel = (req.requestedModel ?? req.requested_model) as
    | Record<string, unknown>
    | undefined;
  const modelDetails = (req.modelDetails ?? req.model_details) as
    | Record<string, unknown>
    | undefined;

  const requestedModelId =
    pickStringField(requestedModel ?? {}, 'model_id', 'modelId') ??
    pickStringField(modelDetails ?? {}, 'model_id', 'modelId');

  const modelDisplayName = pickStringField(
    modelDetails ?? {},
    'display_name',
    'displayName'
  );

  const subagentTypeName = pickStringField(
    req,
    'subagent_type_name',
    'subagentTypeName'
  );

  const requestId =
    pickRequestId(req.requestId ?? req.request_id) ??
    pickStringField(req, 'request_id', 'requestId');

  if (
    !requestedModelId &&
    !modelDisplayName &&
    !subagentTypeName &&
    !requestId
  ) {
    return null;
  }

  return definedAgentFields({
    requestId,
    requestedModelId,
    modelDisplayName,
    subagentTypeName,
    modelName: requestedModelId ?? modelDisplayName,
  });
}

/** Extract conversation and subagent linkage from nested Agent bidi messages. */
export function extractConversationAndSubagentIds(
  decoded: Record<string, unknown>
): Partial<AgentSessionInfo> {
  const result: Partial<AgentSessionInfo> = {};

  const runRequest = pickField(decoded, 'run_request', 'runRequest');
  if (runRequest && typeof runRequest === 'object') {
    const req = runRequest as Record<string, unknown>;
    const conversationId = pickStringField(req, 'conversation_id', 'conversationId');
    if (conversationId) {
      result.conversationId = conversationId;
    }
    const conversationGroupId = pickStringField(
      req,
      'conversation_group_id',
      'conversationGroupId'
    );
    if (conversationGroupId) {
      result.conversationGroupId = conversationGroupId;
    }
    const parentRequestId = pickStringField(
      req,
      'parent_request_id',
      'parentRequestId'
    );
    if (parentRequestId) {
      result.parentRequestId = parentRequestId;
    }
    const subagentRequestId = pickStringField(
      req,
      'subagent_request_id',
      'subagentRequestId'
    );
    if (subagentRequestId) {
      result.subagentRequestId = subagentRequestId;
    }
  }

  const prewarmRequest = pickField(decoded, 'prewarm_request', 'prewarmRequest');
  if (prewarmRequest && typeof prewarmRequest === 'object') {
    const req = prewarmRequest as Record<string, unknown>;
    result.conversationId ??= pickStringField(req, 'conversation_id', 'conversationId');
    result.conversationGroupId ??= pickStringField(
      req,
      'conversation_group_id',
      'conversationGroupId'
    );
  }

  const subagentResult = pickField(decoded, 'subagent_result', 'subagentResult');
  if (subagentResult && typeof subagentResult === 'object') {
    const resultObj = subagentResult as Record<string, unknown>;
    const success = pickField(resultObj, 'success', 'success');
    if (success && typeof success === 'object') {
      const successObj = success as Record<string, unknown>;
      result.subagentRequestId ??= pickStringField(successObj, 'agent_id', 'agentId');
    }
  }

  const taskArgs = pickField(decoded, 'task_tool_call_args', 'taskToolCallArgs');
  if (taskArgs && typeof taskArgs === 'object') {
    const args = taskArgs as Record<string, unknown>;
    result.parentRequestId ??= pickStringField(
      args,
      'parent_request_id',
      'parentRequestId'
    );
    result.subagentRequestId ??= pickStringField(
      args,
      'subagent_request_id',
      'subagentRequestId'
    );
  }

  return result;
}
