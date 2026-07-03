type InstrumentService = {
  listSwapInstruments(): Promise<string[]>;
};

export async function freeReplayInstrumentPayload(instrumentService: InstrumentService): Promise<{ instruments: string[] }> {
  return { instruments: await instrumentService.listSwapInstruments() };
}
