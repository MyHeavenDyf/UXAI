import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Provider } from "@/provider/provider"
import { ProviderAuth } from "@/provider/auth"
import { ProviderID } from "@/provider/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { jsonRequest } from "./trace"

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ListResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.list", c, function* () {
          const svc = yield* Provider.Service
          const connected = yield* svc.list()
          const hasAuth = (p: Provider.Info) =>
            Boolean(p.key) || p.source === "env" || p.source === "api" || Boolean((p.options as Record<string, unknown>)?.apiKey)
          // 诊断日志: opencode/bpit/bpit-beta 的 hasAuth 各分支分解
          for (const p of Object.values(connected)) {
            if (p.id === "opencode" || p.id === "bpit" || p.id === "bpit-beta") {
              console.log("[provider.list] hasAuth breakdown", {
                id: p.id,
                key: Boolean(p.key),
                source: p.source,
                optionsApiKey: Boolean((p.options as Record<string, unknown>)?.apiKey),
                optionsKeys: Object.keys(p.options ?? {}),
                modelsCount: Object.keys(p.models).length,
                result: hasAuth(p),
                t: Date.now(),
              })
            }
          }
          return {
            all: Object.values(connected),
            default: Provider.defaultModelIDs(connected),
            connected: Object.keys(connected).filter((id) => hasAuth(connected[id as keyof typeof connected])),
          }
        }),
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Methods.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.auth", c, function* () {
          const svc = yield* ProviderAuth.Service
          return yield* svc.methods()
        }),
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.AuthorizeInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.authorize", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, inputs } = c.req.valid("json")
          const svc = yield* ProviderAuth.Service
          return yield* svc.authorize({
            providerID,
            method,
            inputs,
          })
        }),
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.CallbackInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.callback", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, code } = c.req.valid("json")
          const svc = yield* ProviderAuth.Service
          yield* svc.callback({
            providerID,
            method,
            code,
          })
          return true
        }),
    ),
)
