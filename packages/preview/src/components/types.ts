import type { A2UIComponentProps,AnyComponentNode } from '../renderer';

export const Size = {
    None: 'none',
    XS: 'xs',
    SM: 'sm',
    MD: 'md',
    LG: 'lg',
} as const

export const SelectMode = {
    Single: 'single',
    Multiple: 'multiple'
} as const

export * from "./componentType";
export type { A2UIComponentProps,AnyComponentNode }