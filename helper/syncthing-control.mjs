import {execFile} from 'node:child_process';
import {randomBytes as cryptoRandomBytes} from 'node:crypto';
import {resolve} from 'node:path';

import {
  encodePairingCode,
  validatePairingPeer,
} from './lan-pairing.mjs';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER_BYTES = 1024 * 1024;
const GENERATED_TRANSNOTE_FOLDER_RE = /^tn-[0-9a-f]{16}$/;

function controlError(code, message, cause) {
  const error = new Error(message, cause ? {cause} : undefined);
  error.code = code;
  return error;
}

export function createExecFileRunner({
  execFileFn = execFile,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  binary = 'syncthing',
} = {}) {
  return args => new Promise((resolveRun, rejectRun) => {
    if (!Array.isArray(args)) {
      rejectRun(controlError('SYNCTHING_COMMAND_FAILED', 'Syncthing arguments must be an array'));
      return;
    }

    execFileFn(
      binary,
      args,
      {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER_BYTES,
        windowsHide: true,
        shell: false,
      },
      (error, stdout = '', stderr = '') => {
        if (!error) {
          resolveRun({stdout: String(stdout), stderr: String(stderr)});
          return;
        }

        if (error.code === 'ENOENT') {
          rejectRun(controlError('SYNCTHING_NOT_FOUND', 'Syncthing is not installed', error));
          return;
        }

        if (error.killed === true || error.code === 'ETIMEDOUT') {
          rejectRun(controlError('SYNCTHING_TIMEOUT', 'Syncthing command timed out', error));
          return;
        }

        rejectRun(controlError('SYNCTHING_COMMAND_FAILED', 'Syncthing command failed', error));
      }
    );
  });
}

function parseJson(raw, label) {
  try {
    return JSON.parse(String(raw ?? ''));
  } catch (cause) {
    throw controlError('SYNCTHING_BAD_RESPONSE', `${label} returned invalid JSON`, cause);
  }
}

function normalizePath(value) {
  return resolve(String(value ?? ''));
}

function folderAtPath(folders, syncDir) {
  const wanted = normalizePath(syncDir);
  return folders.find(folder => normalizePath(folder?.path) === wanted) || null;
}

function requireUsableFolder(folder) {
  if (!folder)
    return;
  if (folder.type !== 'sendreceive')
    throw controlError('FOLDER_NOT_SENDRECEIVE', 'TransNote requires a sendreceive Syncthing folder');
  if (folder.paused === true)
    throw controlError('FOLDER_PAUSED', 'The TransNote Syncthing folder is paused');
}

function deviceIdOf(value) {
  return String(value?.deviceID ?? value?.deviceId ?? value?.id ?? '');
}

function folderHasDevice(folder, deviceId) {
  return Array.isArray(folder?.devices) &&
    folder.devices.some(value => deviceIdOf(value) === deviceId);
}

function folderHasRemoteDevice(folder, localDeviceId) {
  if (!Array.isArray(folder?.devices))
    return false;

  return folder.devices.some(value => {
    const deviceId = deviceIdOf(value);
    return deviceId !== '' && deviceId !== localDeviceId;
  });
}

function isReplaceableProvisionalFolder(folder, localDeviceId) {
  return GENERATED_TRANSNOTE_FOLDER_RE.test(String(folder?.id ?? '')) &&
    String(folder?.label ?? '') === 'transnote-lan' &&
    folder?.type === 'sendreceive' &&
    folder?.paused !== true &&
    !folderHasRemoteDevice(folder, localDeviceId);
}

function deviceNameOf(devices, deviceId) {
  const device = devices.find(value => deviceIdOf(value) === deviceId);
  return String(device?.name ?? '');
}

function pendingTransnoteOffers(pending, devices = []) {
  const offers = [];

  for (const [folderId, value] of Object.entries(pending || {})) {
    if (!value?.offeredBy || typeof value.offeredBy !== 'object')
      continue;

    for (const [syncthingDeviceId, details] of Object.entries(value.offeredBy)) {
      if (String(details?.label ?? '') !== 'transnote-lan')
        continue;

      offers.push({
        folderId,
        syncthingDeviceId,
        deviceName: deviceNameOf(devices, syncthingDeviceId),
        label: 'transnote-lan',
      });
    }
  }

  offers.sort((a, b) =>
    a.folderId.localeCompare(b.folderId) ||
    a.syncthingDeviceId.localeCompare(b.syncthingDeviceId)
  );
  return offers;
}

function generatedFolderId(randomBytes, folders) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const id = `tn-${randomBytes(8).toString('hex')}`;
    if (!folders.some(folder => folder?.id === id))
      return id;
  }
  throw controlError('FOLDER_ID_GENERATION_FAILED', 'Could not generate a unique Syncthing folder id');
}

async function readJson(run, args, label, {systemProbe = false} = {}) {
  try {
    const result = await run(args);
    return parseJson(result.stdout, label);
  } catch (error) {
    if (systemProbe && error?.code === 'SYNCTHING_COMMAND_FAILED')
      throw controlError('SYNCTHING_NOT_RUNNING', 'Syncthing is not running', error);
    throw error;
  }
}

export function createSyncthingControl({
  run = createExecFileRunner(),
  randomBytes = cryptoRandomBytes,
} = {}) {
  async function readSystem() {
    const system = await readJson(
      run,
      ['cli', 'show', 'system'],
      'Syncthing system status',
      {systemProbe: true}
    );
    if (!system || typeof system.myID !== 'string' || system.myID === '')
      throw controlError('SYNCTHING_BAD_RESPONSE', 'Syncthing system status has no device id');
    return system;
  }

  async function readConfig() {
    const config = await readJson(
      run,
      ['cli', 'config', 'dump-json'],
      'Syncthing configuration'
    );
    if (!config || !Array.isArray(config.folders) || !Array.isArray(config.devices))
      throw controlError('SYNCTHING_BAD_RESPONSE', 'Syncthing configuration shape is invalid');
    return config;
  }

  async function readPending() {
    const pending = await readJson(
      run,
      ['cli', 'show', 'pending', 'folders'],
      'Syncthing pending folders'
    );
    if (!pending || typeof pending !== 'object' || Array.isArray(pending))
      throw controlError('SYNCTHING_BAD_RESPONSE', 'Syncthing pending-folder shape is invalid');
    return pending;
  }

  async function readConnections() {
    const value = await readJson(
      run,
      ['cli', 'show', 'connections'],
      'Syncthing connections'
    );
    if (!value || typeof value.connections !== 'object' || Array.isArray(value.connections))
      throw controlError('SYNCTHING_BAD_RESPONSE', 'Syncthing connection shape is invalid');
    return value.connections;
  }

  return {
    async prepare({transnoteDeviceId, syncDir}) {
      const system = await readSystem();
      const config = await readConfig();
      const cleanPath = normalizePath(syncDir);
      let folder = folderAtPath(config.folders, cleanPath);

      if (folder) {
        requireUsableFolder(folder);
      } else {
        const pending = await readPending();
        if (pendingTransnoteOffers(pending, config.devices).length > 0) {
          throw controlError(
            'PENDING_TRANSNOTE_OFFER',
            'A TransNote folder offer is waiting for explicit acceptance'
          );
        }

        const folderId = generatedFolderId(randomBytes, config.folders);
        await run([
          'cli', 'config', 'folders', 'add',
          '--id', folderId,
          '--label', 'transnote-lan',
          '--path', cleanPath,
        ]);
        folder = {
          id: folderId,
          path: cleanPath,
          type: 'sendreceive',
          paused: false,
          devices: [],
        };
      }

      const pairingCode = encodePairingCode({
        transnoteDeviceId,
        syncthingDeviceId: system.myID,
        folderId: folder.id,
      });

      return {
        localDeviceId: system.myID,
        folderId: folder.id,
        folderPath: cleanPath,
        pairingCode,
      };
    },

    async pair({localTransnoteDeviceId, syncDir, remote}) {
      const system = await readSystem();
      const cleanRemote = validatePairingPeer({
        remote,
        localTransnoteDeviceId,
        localSyncthingDeviceId: system.myID,
      });
      const config = await readConfig();
      const pending = await readPending();
      const cleanPath = normalizePath(syncDir);
      let byPath = folderAtPath(config.folders, cleanPath);
      const byId = config.folders.find(folder => folder?.id === cleanRemote.folderId) || null;

      if (byId && normalizePath(byId.path) !== cleanPath)
        throw controlError('FOLDER_PATH_CONFLICT', 'This Syncthing folder id exists at another path');

      const offer = pending[cleanRemote.folderId];
      if (offer && offer.offeredBy && typeof offer.offeredBy === 'object') {
        const offerers = Object.keys(offer.offeredBy);
        if (offerers.length > 0 && !offerers.includes(cleanRemote.syncthingDeviceId)) {
          throw controlError(
            'PENDING_OFFER_MISMATCH',
            'Pending Syncthing folder offer does not match the pairing code'
          );
        }
      }

      if (byPath && byPath.id !== cleanRemote.folderId) {
        if (!isReplaceableProvisionalFolder(byPath, system.myID)) {
          throw controlError(
            'FOLDER_ID_CONFLICT',
            'This path belongs to a different Syncthing folder id'
          );
        }

        await run([
          'cli',
          'config',
          'folders',
          byPath.id,
          'delete',
        ]);
        byPath = null;
      }

      const existingFolder = byPath || byId;
      requireUsableFolder(existingFolder);

      const deviceExists = config.devices.some(
        value => deviceIdOf(value) === cleanRemote.syncthingDeviceId
      );
      if (!deviceExists) {
        await run([
          'cli', 'config', 'devices', 'add',
          '--device-id', cleanRemote.syncthingDeviceId,
        ]);
      }

      let folder = existingFolder;
      if (!folder) {
        await run([
          'cli', 'config', 'folders', 'add',
          '--id', cleanRemote.folderId,
          '--label', 'transnote-lan',
          '--path', cleanPath,
        ]);
        folder = {
          id: cleanRemote.folderId,
          path: cleanPath,
          type: 'sendreceive',
          paused: false,
          devices: [],
        };
      }

      if (!folderHasDevice(folder, cleanRemote.syncthingDeviceId)) {
        await run([
          'cli', 'config', 'folders', cleanRemote.folderId,
          'devices', 'add',
          '--device-id', cleanRemote.syncthingDeviceId,
        ]);
      }

      return {
        peer: {
          transnoteDeviceId: cleanRemote.transnoteDeviceId,
          syncthingDeviceId: cleanRemote.syncthingDeviceId,
          folderId: cleanRemote.folderId,
        },
      };
    },

    async acceptPending({syncDir, folderId, syncthingDeviceId}) {
      await readSystem();
      const config = await readConfig();
      const pending = await readPending();
      const cleanFolderId = String(folderId ?? '').trim();
      const cleanDeviceId = String(syncthingDeviceId ?? '').trim();
      const offer = pending[cleanFolderId];
      const details = offer?.offeredBy?.[cleanDeviceId];

      if (!details)
        throw controlError('PENDING_OFFER_NOT_FOUND', 'Selected pending folder offer was not found');
      if (String(details.label ?? '') !== 'transnote-lan') {
        throw controlError(
          'PENDING_OFFER_NOT_TRANSNOTE',
          'Selected pending folder offer is not labeled transnote-lan'
        );
      }

      const configuredDevice = config.devices.find(
        value => deviceIdOf(value) === cleanDeviceId
      );
      if (!configuredDevice) {
        throw controlError(
          'PENDING_DEVICE_NOT_CONFIGURED',
          'Offering Syncthing device is not configured locally'
        );
      }

      const cleanPath = normalizePath(syncDir);
      const byPath = folderAtPath(config.folders, cleanPath);
      const byId = config.folders.find(folder => folder?.id === cleanFolderId) || null;

      if (byPath && byPath.id !== cleanFolderId)
        throw controlError('FOLDER_ID_CONFLICT', 'This path belongs to a different Syncthing folder id');
      if (byId && normalizePath(byId.path) !== cleanPath)
        throw controlError('FOLDER_PATH_CONFLICT', 'This Syncthing folder id exists at another path');

      let folder = byPath || byId;
      requireUsableFolder(folder);

      if (!folder) {
        await run([
          'cli', 'config', 'folders', 'add',
          '--id', cleanFolderId,
          '--label', 'transnote-lan',
          '--path', cleanPath,
        ]);
        folder = {
          id: cleanFolderId,
          path: cleanPath,
          type: 'sendreceive',
          paused: false,
          devices: [],
        };
      }

      if (!folderHasDevice(folder, cleanDeviceId)) {
        await run([
          'cli', 'config', 'folders', cleanFolderId,
          'devices', 'add',
          '--device-id', cleanDeviceId,
        ]);
      }

      return {
        folderId: cleanFolderId,
        folderPath: cleanPath,
        syncthingDeviceId: cleanDeviceId,
        deviceName: String(configuredDevice.name ?? ''),
      };
    },

    async status({syncDir, peers = []}) {
      let system;
      try {
        system = await readSystem();
      } catch (error) {
        if (error?.code === 'SYNCTHING_NOT_FOUND') {
          return {
            installed: false,
            running: false,
            localDeviceId: '',
            folder: {configured: false},
            peers: [],
            pendingFolders: 0,
            pendingOffers: [],
            pendingOffers: [],
          };
        }
        if (error?.code === 'SYNCTHING_NOT_RUNNING') {
          return {
            installed: true,
            running: false,
            localDeviceId: '',
            folder: {configured: false},
            peers: [],
            pendingFolders: 0,
          };
        }
        throw error;
      }

      const config = await readConfig();
      const connections = await readConnections();
      const pending = await readPending();
      const folder = syncDir ? folderAtPath(config.folders, syncDir) : null;
      const folderState = folder
        ? {
            configured: true,
            id: folder.id,
            path: normalizePath(folder.path),
            type: folder.type,
            paused: folder.paused === true,
          }
        : {configured: false};

      const peerStates = (Array.isArray(peers) ? peers : []).map(peer => {
        const deviceConfigured = config.devices.some(
          value => deviceIdOf(value) === peer.syncthingDeviceId
        );
        const folderConfigured = Boolean(
          folder &&
          folder.id === peer.folderId &&
          folderHasDevice(folder, peer.syncthingDeviceId)
        );
        return {
          transnoteDeviceId: peer.transnoteDeviceId,
          syncthingDeviceId: peer.syncthingDeviceId,
          configured: deviceConfigured && folderConfigured,
          connected: connections[peer.syncthingDeviceId]?.connected === true,
        };
      });

      return {
        installed: true,
        running: true,
        localDeviceId: system.myID,
        folder: folderState,
        peers: peerStates,
        pendingFolders: Object.keys(pending).length,
        pendingOffers: pendingTransnoteOffers(pending, config.devices),
      };
    },
  };
}
