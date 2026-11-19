// Tell IndexNow engines (Bing, Yandex, Seznam, Naver; Bing feeds ChatGPT search and Copilot) which pages changed.
//   npm run indexnow                      -> every URL in the live sitemap
//   npm run indexnow -- /fcs /use-cases/borrow
// Run it after a deploy that changes content. The key file is public/<KEY>.txt, served at the site root.
const HOST = "frankencoin.com";
const KEY = "8f1076763d62ec2302ce2df1f9f992c4";

async function sitemapUrls() {
  const index = await (await fetch(`https://${HOST}/sitemap-index.xml`)).text();
  const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const map of maps) {
    const xml = await (await fetch(map)).text();
    urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }
  return [...new Set(urls)];
}

const args = process.argv.slice(2);
const urlList = args.length ? args.map((p) => new URL(p, `https://${HOST}`).href) : await sitemapUrls();

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});
// 200 or 202 means accepted; 403 means the key file is not reachable yet; 422 means a URL is not on the host.
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} URLs`);
if (!res.ok && res.status !== 202) process.exitCode = 1;
