import type { AgentSessionInfo } from '../../application/types/agentTracking';
import type { WorkspaceInfo } from '../../application/types/proxyInsights';
import { pickField } from './fieldNormalization';
import {
  definedAgentFields,
  fillMissingAgentFields,
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

function extractRunRequestRelationships(
  value: unknown
): Partial<AgentSessionInfo> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const request = value as Record<string, unknown>;
  return definedAgentFields({
    conversationId: pickStringField(
      request,
      'conversation_id',
      'conversationId'
    ),
    conversationGroupId: pickStringField(
      request,
      'conversation_group_id',
      'conversationGroupId'
    ),
    parentRequestId: pickStringField(
      request,
      'parent_request_id',
      'parentRequestId'
    ),
    subagentRequestId: pickStringField(
      request,
      'subagent_request_id',
      'subagentRequestId'
    ),
  });
}

function extractPrewarmRelationships(
  value: unknown
): Partial<AgentSessionInfo> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const request = value as Record<string, unknown>;
  return definedAgentFields({
    conversationId: pickStringField(
      request,
      'conversation_id',
      'conversationId'
    ),
    conversationGroupId: pickStringField(
      request,
      'conversation_group_id',
      'conversationGroupId'
    ),
  });
}

function extractSubagentResultRelationships(
  value: unknown
): Partial<AgentSessionInfo> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const success = pickField(value as Record<string, unknown>, 'success', 'success');
  if (!success || typeof success !== 'object') {
    return {};
  }
  return definedAgentFields({
    subagentRequestId: pickStringField(
      success as Record<string, unknown>,
      'agent_id',
      'agentId'
    ),
  });
}

function extractTaskRelationships(value: unknown): Partial<AgentSessionInfo> {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const args = value as Record<string, unknown>;
  return definedAgentFields({
    parentRequestId: pickStringField(
      args,
      'parent_request_id',
      'parentRequestId'
    ),
    subagentRequestId: pickStringField(
      args,
      'subagent_request_id',
      'subagentRequestId'
    ),
  });
}

/** Extract conversation and subagent linkage from nested Agent bidi messages. */
export function extractConversationAndSubagentIds(
  decoded: Record<string, unknown>
): Partial<AgentSessionInfo> {
  let result = extractRunRequestRelationships(
    pickField(decoded, 'run_request', 'runRequest')
  );
  result = fillMissingAgentFields(
    result,
    extractPrewarmRelationships(pickField(decoded, 'prewarm_request', 'prewarmRequest'))
  );
  result = fillMissingAgentFields(
    result,
    extractSubagentResultRelationships(
      pickField(decoded, 'subagent_result', 'subagentResult')
    )
  );
  return fillMissingAgentFields(
    result,
    extractTaskRelationships(
      pickField(decoded, 'task_tool_call_args', 'taskToolCallArgs')
    )
  );
}
