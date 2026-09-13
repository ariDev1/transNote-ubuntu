import {machineNameForSeed} from './machineName.js';

export function setupDefaults({
  deviceId,
  syncDir,
  seed,
  homeDir,
}) {
  const currentDeviceId = String(deviceId ?? '').trim();
  const currentSyncDir = String(syncDir ?? '').trim();

  if (currentDeviceId !== '' || currentSyncDir !== '') {
    return {
      deviceId: currentDeviceId,
      syncDir: currentSyncDir,
      initialized: false,
    };
  }

  const home = String(homeDir ?? '').replace(/\/+$/, '');

  return {
    deviceId: machineNameForSeed(seed),
    syncDir: `${home}/transnote-lan`,
    initialized: true,
  };
}
