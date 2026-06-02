import type { A2UIComponentProps,AnyComponentNode } from '../renderer';

export enum Size {
    None = 'none',
    XS = 'xs',
    SM = 'sm',
    MD = 'md',
    LG = 'lg',
}

export enum SelectMode {
    Single = 'single',
    Multiple = 'multiple'
}

export * from "./componentType";
export type { A2UIComponentProps,AnyComponentNode }