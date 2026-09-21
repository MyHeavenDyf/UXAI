import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { described } from "./metadata"

export class ApiStudioPermissionError extends Schema.ErrorClass<ApiStudioPermissionError>("StudioPermissionError")(
  {
    name: Schema.Literal("StudioPermissionError"),
    data: Schema.Struct({
      message: Schema.String,
    }),
  },
  { httpApiStatus: 502 },
) {}

export const StudioGlobalPermissionPayload = Schema.Struct({
  uid: Schema.optional(Schema.String),
})

export const StudioGlobalApi = HttpApi.make("studio-global").add(
  HttpApiGroup.make("studio.global")
    .add(
      HttpApiEndpoint.post("checkPermission", "/global/studio/permissions/check", {
        payload: StudioGlobalPermissionPayload,
        success: described(Schema.Unknown, "Studio permission result"),
        error: ApiStudioPermissionError,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "global.studio.permissions.check",
          summary: "Check Studio permission",
          description: "Checks Studio capabilities without initializing a workspace instance.",
        }),
      ),
    )
    .annotateMerge(OpenApi.annotations({ title: "studio.global", description: "Global Studio routes." }))
    .middleware(Authorization),
)
