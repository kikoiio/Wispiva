import { loadModelConfig } from '../model/config.mjs';
import { createWorldRepository } from '../storage/world-repository.mjs';
import { MODEL_REQUEST_TIMEOUT_MS } from './creation-limits.mjs';
import { createCreationWorkspace } from './workspace.mjs';
import { createRequestSession } from './request-session.mjs';
import { createModelGateway } from './model-gateway.mjs';
import { createWorldLifecycle } from './world-lifecycle.mjs';
import { createCreationControls } from './controls.mjs';
import { createDiscussionFlow } from './flows/discussion.mjs';
import { createGenesisFlow } from './flows/genesis.mjs';

export function createWorldCreation({ stateFile, createExperience, configLoader = loadModelConfig, fetchImpl = globalThis.fetch,
  requestTimeoutMs = MODEL_REQUEST_TIMEOUT_MS } = {}) {
  const repository = createWorldRepository(stateFile);
  const requests = createRequestSession();
  const workspace = createCreationWorkspace({ repository, requestCheckpoint: requests.checkpoint });
  const world = createWorldLifecycle({ stateFile, repository, workspace,
    openExperience: () => createExperience({ stateFile, configLoader, fetchImpl, requestTimeoutMs }),
  });
  requests.setResult(workspace.creation.lastResult);
  const models = createModelGateway({ configLoader, fetchImpl, requestTimeoutMs, audit: repository.audit });
  const state = () => ({ ...world.state(), creation: { ...workspace.view(), hasWorld: world.hasWorld },
    ...(requests.pending || workspace.creation.mode === 'create' ? { model: requests.snapshot() } : {}),
  });
  const response = (ok, message, extra = {}) => ({ ok, message, ...extra, state: state() });
  const blocked = () => requests.pending || world.pending;
  const control = createCreationControls({ workspace, world, blocked, response });
  const discussStep = createDiscussionFlow({ workspace, requests, models, blocked, response, state });
  const worldStep = createGenesisFlow({ workspace, requests, models, blocked, response, state });
  const delegate = name => async (body, options) => {
    if (requests.pending || workspace.creation.mode !== 'world' || !world.hasWorld) return response(false, '先进入世界，再进行操作。');
    const result = await world[name](body, options);
    return { ...result, state: state() };
  };
  const cancelModel = () => {
    const request = requests.cancel();
    if (!request) {
      const result = world.cancelModel();
      return result ? { ...result, state: state() } : response(false, '没有进行中的模型调用。');
    }
    // Finalization owns the atomic scene/outcome commit and its failure path.
    if (!request.finalizing) workspace.save();
    return response(true, '已请求取消创建世界。');
  };
  return { state, control, discussStep, worldStep, actorStep: delegate('actorStep'), sceneStep: delegate('sceneStep'), cancelModel,
    close() { requests.cancel(); world.close(); workspace.save(); },
  };
}
