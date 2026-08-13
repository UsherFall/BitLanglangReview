import { defaultFetchJson, type FetchJson } from './http';

type OkxInstrumentsResponse = {
  data?: Array<{ instId?: string }>;
};

export class OkxInstrumentService {
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  async listSwapInstruments(): Promise<string[]> {
    const response = (await this.fetchJson('https://www.okx.com/api/v5/public/instruments?instType=SWAP')) as OkxInstrumentsResponse;
    return [...new Set((response.data ?? []).map((item) => item.instId).filter((instId): instId is string => Boolean(instId)))]
      .sort();
  }
}
