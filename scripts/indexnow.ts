import { INDEXNOW_KEY, PRODUCTION_URL } from "../src/config/site";
import { publicPages } from "../src/lib/seo/sitemap";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** IndexNow's shared endpoint: it passes the URLs on to every participating engine. */
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow";

/**
 * Tells the IndexNow engines (Bing, Yandex, Seznam, Naver, Yep and others; indexnow.org) that the
 * public pages at `baseUrl` changed. Run it after a deploy that changes the landing or the legal
 * pages, not on every deploy: IndexNow asks for changed URLs only.
 * @throws Error naming the status when IndexNow refuses (400 bad request, 403 key not valid,
 * 422 URLs not of this host, 429 too many requests)
 */
export async function submitToIndexNow(input: {
  baseUrl: string;
  fetch?: Fetch;
}): Promise<{ status: number; urls: number }> {
  const send = input.fetch ?? fetch;
  const urlList = publicPages(input.baseUrl).map((page) => page.url);
  const response = await send(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(input.baseUrl).host,
      key: INDEXNOW_KEY,
      keyLocation: `${input.baseUrl}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
  });
  if (!response.ok) {
    throw new Error(`IndexNow answered ${response.status}.`);
  }
  return { status: response.status, urls: urlList.length };
}

if (import.meta.main) {
  try {
    const { status, urls } = await submitToIndexNow({
      baseUrl: PRODUCTION_URL,
    });
    process.stdout.write(`IndexNow accepted ${urls} URLs (${status}).\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
