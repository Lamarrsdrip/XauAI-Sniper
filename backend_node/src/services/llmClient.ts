/**
 * Port of backend/llm_adapter.py -- thin HTTP wrapper around Anthropic
 * `/v1/messages` and OpenAI `/v1/chat/completions`. No SDK dependency in
 * the Python original, so none needed here either.
 */
export class LlmChat {
  private readonly apiKey: string;
  private provider = "";
  private model = "";
  private readonly systemMessage: string;

  constructor(opts: { apiKey: string; sessionId: string; systemMessage: string }) {
    this.apiKey = opts.apiKey;
    this.systemMessage = opts.systemMessage;
  }

  withModel(provider: string, model: string): this {
    this.provider = provider.trim().toLowerCase();
    this.model = model;
    return this;
  }

  async sendMessage(text: string): Promise<string> {
    if (!this.apiKey) throw new Error("LLM provider key is not configured");
    if (this.provider === "anthropic") return this.anthropic(text);
    if (this.provider === "openai") return this.openai(text);
    throw new Error(`Unsupported LLM provider: ${this.provider || "unset"}`);
  }

  private async anthropic(text: string): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1200,
        system: this.systemMessage,
        messages: [{ role: "user", content: text }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Anthropic HTTP ${response.status}`);
    const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const rendered = (body.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    if (!rendered) throw new Error("Anthropic returned no text content");
    return rendered;
  }

  private async openai(text: string): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: this.systemMessage },
          { role: "user", content: text },
        ],
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`OpenAI HTTP ${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const choices = body.choices ?? [];
    if (choices.length === 0) throw new Error("OpenAI returned no choices");
    const rendered = choices[0]?.message?.content ?? "";
    if (!rendered) throw new Error("OpenAI returned no text content");
    return rendered;
  }
}
