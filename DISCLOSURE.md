# Disclosure — Baloon National Hackathon 2026 · FlowForge

> Honest disclosure of third-party code, components, external APIs, datasets, and AI tools.

## AI tools used
| Tool | Used for | Notes |
|------|----------|-------|
| AI coding assistant | Scaffolding, writing, and refactoring application code | All output was reviewed by the team; we remain responsible for correctness, security, and licensing. |

## External APIs / services
| API / service | Purpose | License / terms |
|---------------|---------|-----------------|
| OpenAI API | Optional live completions for the AI node (only if `OPENAI_API_KEY` is set). The app ships with a fully offline mock fallback, so no key is required. | OpenAI API terms |
| Resend API | Optional live email delivery for the Send Email node (only if a Resend key is configured on the node or as `RESEND_API_KEY`). | Resend terms |
| HTTP mail gateway | Optional live email delivery — an endpoint you provide (`MAIL_GATEWAY_URL` or the node's gateway URL) that receives `{from,to,subject,text}` as JSON. | Your own service |
| Upstash / Vercel KV (REST) | Optional durable remote storage for workflows and runs (`KV_REST_API_URL`+`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`+`UPSTASH_REDIS_REST_TOKEN`). Without credentials, storage falls back to local/ephemeral modes. | Upstash / Vercel terms |
| jsonplaceholder.typicode.com | Public, free fake-REST API used only as the example endpoint inside demo templates (HTTP node). | Free public test API |

## Honest limitations

Stated plainly, so judges are never misled by the docs or the demo:

1. **Batch Split does not iterate.** The `logic.loop` node ("Batch Split") slices an array
   field into a batch of up to N items and passes that batch downstream **in a single pass**.
   It never executed per-item iterations, and its labelling now says so. For per-item work,
   map over the batch in a Code node.
2. **Secrets need `FF_SECRET_*` environment variables and are unavailable in the browser.**
   `{{secrets.NAME}}` references resolve only in server-side runs from the server environment.
   In-browser runs resolve no secrets, and a node that needs one fails with an AUTH diagnosis
   rather than silently sending nothing.
3. **The durable KV backend requires credentials.** Remote KV (Upstash / Vercel KV REST) is
   used only when `KV_REST_API_URL`+`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`+
   `UPSTASH_REDIS_REST_TOKEN`) are configured. Otherwise storage is the project's `data/`
   directory (durable on a VM/container), the OS temp dir (ephemeral, per-instance, seeded with
   demo data), or in-process memory (last resort). The active mode and the reason a better
   backend was rejected are reported by `GET /api/health`.
4. **Two conformance checks are intentionally skipped.** The Node Conformance Suite reports
   226 passed / 0 failed / 2 skipped: `action.writeFile`'s invocation checks are skipped
   *deliberately* because executing them would write a real file to disk — a health check must
   never mutate data. The skips are reported with their reason, not hidden.
5. **Email delivery is live only when a transport is configured.** With a Resend key or a mail
   gateway URL the Send Email node delivers for real; otherwise it runs in mock mode that
   delivers nothing and says so — the log prints an explicit `SIMULATED email (mock mode)`
   warning and the output records `delivered: false, simulated: true`. A simulated side effect
   is flagged on the node result and rolled up into the run's `anySimulated`, never presented
   as a real delivery.

## Datasets
| Dataset | Source | License | How used |
|---------|--------|---------|----------|
| — | — | — | No datasets were used. |

## Notable libraries / frameworks
| Library | License |
|---------|---------|
| Next.js | MIT |
| React / React DOM | MIT |
| React Flow (reactflow) | MIT |
| Zustand | MIT |
| Tailwind CSS | MIT |
| lucide-react | ISC |
| nanoid | MIT |
| clsx | MIT |
| Framer Motion | MIT |
| Three.js | MIT |
| @react-three/fiber | MIT |
| Lenis (smooth scroll) | MIT |

## Templates / starters / third-party assets
| Asset | Source | License |
|-------|--------|---------|
| Icons | lucide-react icon set | ISC |
| Fonts | Inter & JetBrains Mono (via next/font) | SIL Open Font License |

## Pre-existing code
- [x] No substantial pre-existing project base was used. All substantial work was done during the event window.
