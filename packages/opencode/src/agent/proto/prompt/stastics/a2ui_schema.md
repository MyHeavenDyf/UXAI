{
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "Surface Schema",
    "description": "A JSON payload for dynamically constructing a UI surface.",
    "type": "object",
    "required": [
        "state",
        "elements",
        "rootId"
    ],
    "additionalProperties": false,
    "properties": {
        "state": {
            "description": "The data store for the surface.",
            "type": "object",
            "additionalProperties": true
        },
        "rootId": {
            "description": "The ID of the root element.",
            "type": "string"
        },
        "elements": {
            "description": "A flat list of all elements.",
            "type": "array",
            "minItems": 1,
            "items": {
                "type": "object",
                "description": "A element node. The 'component' field determines the type. See ../examples/ for available component types and their props, organized by category.",
                "required": [
                    "id",
                    "component"
                ],
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "A unique identifier for this component within the surface."
                    },
                    "component": {
                        "type": "string",
                        "description": "The component type name. See ../examples/ for all available types."
                    },
                    "props": {
                        "type": "object",
                        "description": "Component-specific properties. See the corresponding component definition in ../examples/ for available props.",
                        "additionalProperties": true
                    },
                    "children": {
                        "oneOf": [
                            {
                                "type": "array",
                                "items": {
                                    "type": "string"
                                },
                                "description": "A static list of child component IDs."
                            },
                            {
                                "type": "object",
                                "description": "A template for generating a dynamic list of children from a data model list.",
                                "required": [
                                    "componentId",
                                    "path"
                                ],
                                "additionalProperties": false,
                                "properties": {
                                    "componentId": {
                                        "type": "string",
                                        "description": "The ID of the component to use as a template for each list item."
                                    },
                                    "path": {
                                        "type": "string",
                                        "description": "The JSON Pointer path to the list in the data model, e.g. '/listData'."
                                    }
                                }
                            }
                        ],
                        "description": "Defines the children of this component. Use an array of IDs for a fixed set of children, or a template object to generate children from a data list. Children must be referenced by ID, not defined inline."
                    }
                }
            }
        }
    }
}