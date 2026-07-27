# @dom-picker/vue

Vue integration for DOM picker.

## Exports

- `@dom-picker/vue`
- `@dom-picker/vue/runtime`
- `@dom-picker/vue/node-transform`

## Runtime

```js
import { installVueDomPicker } from '@dom-picker/vue'

if (import.meta.env.DEV) {
  installVueDomPicker()
}
```

## Template Transform

```js
import createDomPickerVueNodeTransform from '@dom-picker/vue/node-transform'
```
