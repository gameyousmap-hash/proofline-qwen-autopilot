# Alibaba Cloud deployment evidence

This directory is the deployable analysis backend used by Proofline Autopilot. The web application retrieves official Diet records, then sends only the normalized evidence packet to this Alibaba Cloud Function Compute function. The function invokes Qwen Cloud through its international OpenAI-compatible endpoint and returns an evidence-ID-constrained JSON analysis.

## Deploy

Requirements: Alibaba Cloud account, Serverless Devs CLI v3, a Qwen Cloud international API key, and Function Compute enabled in Singapore (`ap-southeast-1`).

```bash
cd alibaba-cloud/function-compute
set QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
set QWEN_API_KEY=your_model_studio_key
set QWEN_MODEL=qwen3.7-plus
set PROOFLINE_SERVICE_SECRET=a_long_random_value
s deploy
```

On Windows, once the Serverless Devs `default` access alias is configured, run
`npm run deploy:alibaba` from the repository root. The helper loads the four
required values from `.env.local`, does not print them, and deploys with
`--assume-yes`.

The helper captures Serverless Devs output because the CLI includes resolved
environment variables in its normal deployment summary. It prints only the
deployment result and public function URL, and redacts configured values from
failure diagnostics.

Copy the deployed HTTP trigger URL into `ALIBABA_AUTOPILOT_URL` in the web application and use the same secret as `ALIBABA_AUTOPILOT_SECRET`.

No Alibaba Cloud access key or Qwen API key is committed to the repository. The HTTP trigger is protected at the application layer with `x-proofline-service-key`; production deployments should additionally enable an Alibaba Cloud API Gateway or private network policy.
