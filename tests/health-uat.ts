const baseUrl = process.env.UAT_BASE_URL || `http://localhost:${process.env.PORT || "3104"}`;

async function main() {
  const response = await fetch(`${baseUrl}/api/health`);
  if (!response.ok) throw new Error(`Health endpoint failed with ${response.status}`);
  const body = await response.json();
  if (body.ok !== true || body.service !== "easynet-finance-ai" || body.version !== "1.0.0") throw new Error(`Unexpected health payload: ${JSON.stringify(body)}`);
  console.log(JSON.stringify({ database: "live read-only", liveDatabaseChanged: false, baseUrl, status: response.status, service: body.service, version: body.version }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
