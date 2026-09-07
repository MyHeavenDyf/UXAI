{
    "name": "HTML5 Element",
    "description": "Standard HTML5 tags.",
    "type": "object",
    "definitions": {
        "DynamicString": {
            "oneOf": [
                { "type": "string" },
                {
                    "type": "object",
                    "description": "JSON Pointer state reference",
                    "required": ["path"],
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "A JSON Pointer path to a value in the state",
						    "examples": ["/users", "/form/name", "name", "role"]
                        }
                    }
                }
            ]
        },
        "DynamicChildren": {
            "oneOf": [
                {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "description": "The unique identifier for an element"
                    },
                    "description": "A static list of child element IDs."
                },
                {
                    "type": "object",
                    "description": "A template for generating a dynamic list of children from a state array.",
                    "required": ["componentId", "path"],
                    "properties": {
                        "componentId": {
                            "type": "string",
                            "description": "The template element ID for each array item."
                        },
                        "path": {
                            "type": "string",
                            "description": "Dynamic Pointer path pointing to an array in the state."
                        }
                    }
                }
            ]
        }
    },
    "properties": {
        "id": {
            "type": "string",
            "description": "Unique ID for cross-referencing."
        },
        "component": {
            "type": "string",
            "description": "MUST be a valid lowercase HTML5 tag (e.g., div, span, p, img, a, section).",
            "pattern": "^[a-z]+[1-6]?$"
        },
        "props": {
            "type": "object",
            "description": "Properties and attributes for the HTML5 tag.",
            "properties": {
                "className": {
                    "type": "string",
                    "description": "Tailwind CSS classes for layout, spacing, color, and styling."
                },
                "value": {
                    "$ref": "#/definitions/DynamicString",
                    "description": "Text content of the tag."
                },
                "src": {
                    "$ref": "#/definitions/DynamicString",
                    "description": "Source URL for img tags."
                },
                "alt": {
                    "type": "string",
                    "description": "Alternative text for img tags."
                },
                "href": {
                    "$ref": "#/definitions/DynamicString",
                    "description": "Hyperlink reference for 'a' tags."
                },
                "target": {
                    "type": "string",
                    "enum": ["_blank", "_self", "_parent", "_top"],
                    "description": "Where to open the linked document (used with 'a' tags)."
                },
                "title": {
                    "$ref": "#/definitions/DynamicString",
                    "description": "Extra information about an element, usually shown as a tooltip on hover."
                }
            }
        },
        "children": {
            "$ref": "#/definitions/DynamicChildren",
            "description": "Child elements IDs"
        }
    },
    "required": ["id", "component"]
}