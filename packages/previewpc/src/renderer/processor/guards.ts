
import type { TemplateChildren, DataBinding, JsonComponentNode } from './type'
function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateChildren(value: unknown): value is TemplateChildren {
    return isObject(value) && "path" in value && "componentId" in value
}

function isDataBinding(value: unknown): value is DataBinding {
    return isObject(value) && "path" in value && typeof value.path === "string" && Object.keys(value).length === 1
}

function isComponentNode(value: unknown): value is JsonComponentNode {
    return isObject(value) && "componentId" in value && typeof value.componentId === "string" && Object.keys(value).length === 1
}


export { isTemplateChildren, isObject, isDataBinding, isComponentNode }