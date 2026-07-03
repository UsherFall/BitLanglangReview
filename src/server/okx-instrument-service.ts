type FetchJson = (url: string) => Promise<unknown>;

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

async function defaultFetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  if (!response.ok) {
    throw new Error(`OKX request failed: ${response.status}`);
  }
  return response.json();
}
