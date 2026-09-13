export const ENTERPRISE_MACHINE_NAMES = Object.freeze([
  'WarpCoreCoffee',
  'RedShirtTerminal',
  'Holodeck404',
  'TribbleContainment',
  'TransporterBuffer',
  'EngineeringNeedsCoffee',
  'SickbayAgain',
  'BridgeNoPanic',
  'TenForwardServer',
  'PhotonTorpedoDesk',
  'ShuttleBayDoor',
  'CaptainIsBusy',
  'DataWasHere',
  'WorfSecurity',
  'GeordiDiagnostics',
  'RikersChair',
  'PicardsTea',
  'QDidIt',
  'BorgNotFound',
  'WarpFactorNine',
  'DilithiumLow',
  'ComputerSaysNo',
  'HolodeckOffline',
  'RedAlertMaybe',
  'TransporterOops',
  'EnterpriseBasement',
  'EngineeringProblem',
  'CaptainOnBreak',
  'TeaEarlGreyHot',
  'NoTribbleZone',
  'ReplicatorBusy',
  'WarpDrivePending',
  'ShieldsMostlyUp',
  'PhasersOnMaybe',
  'MainComputerSaysMaybe',
  'BridgeNeedsCoffee',
  'TurboliftLost',
  'HolodeckSafetyOff',
  'TenForwardClosed',
  'ChiefEngineerSighs',
  'StarfleetHelpdesk',
  'TransporterRoomThree',
  'DeckThirtySeven',
  'CaptainNeedsTea',
  'RedShirtSurvived',
  'WarpCoreNominalish',
  'BorgResistancePending',
  'EnterprisePrinter',
]);

export function machineNameForSeed(seed) {
  const text = String(seed ?? '').trim() || 'transnote';
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return ENTERPRISE_MACHINE_NAMES[hash % ENTERPRISE_MACHINE_NAMES.length];
}
