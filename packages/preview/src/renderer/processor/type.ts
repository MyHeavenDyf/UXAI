

interface DataBinding {
    path: string
}

interface JsonComponentNode {
    componentId: string
}

type SurfaceId = string;

type DynamicString = string | DataBinding

type DynamicNumber = number | DataBinding
type DynamicBoolean = boolean | DataBinding
type DynamicStringList = string[] | DataBinding
type DynamicValue = string | number | boolean | DataBinding

/** A recursive type for any valid JSON-like value in the data model. */
type DataValue =
    | string
    | number
    | boolean
    | null
    | DataMap
    | DataArray;
type DataMap = { [key: string]: DataValue };
type DataArray = DataValue[];


interface JsonInput {
    state: Record<string, any>;
    rootId: string;
    elements: ComponentInstance[];
}

interface TemplateChildren {
    componentId: string;
    path: string
}


type ResolvedValue =
    | null
    | AnyComponentNode
    | ResolvedMap
    | ResolvedArray
    | DynamicValue

type ResolvedMap = { [key: string]: ResolvedValue };

type ResolvedArray = ResolvedValue[];


interface BaseComponentNode {
    id: string;
    weight?: number;
}

interface AnyComponentNode<T = Record<string, ResolvedValue>> extends BaseComponentNode {
    type: string
    properties: T
}

interface ComponentInstance extends BaseComponentNode {
    component: string;
    props?: Record<string, any>;
    children?: ComponentChildren
}

type ComponentChildren = string[] | TemplateChildren

interface Action {
    name: string;
    context: DynamicValue
}

interface A2UIComponentProps<T extends AnyComponentNode<any>> {
    node: T;
    surfaceId: string
}

interface A2UIClientEventMessage {
    userAction?: Action
}

export {
    SurfaceId,
    JsonInput,
    ResolvedValue,
    ComponentInstance,
    ResolvedMap,
    DataMap,
    ComponentChildren,
    DynamicString,
    DynamicNumber,
    DynamicBoolean,
    AnyComponentNode,
    DataValue,
    TemplateChildren,
    DataBinding,
    A2UIComponentProps,
    BaseComponentNode,
    Action,
    DynamicStringList,
    A2UIClientEventMessage,
    JsonComponentNode
}