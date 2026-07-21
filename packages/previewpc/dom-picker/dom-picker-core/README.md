# @dom-picker/core

Shared browser runtime for DOM picker overlays, source range display, and editor jump commands.

## Exports

- `@dom-picker/core`
- `@dom-picker/core/runtime`

## Usage

```js
import { installDomPicker } from '@dom-picker/core'

installDomPicker({
  logPrefix: 'dom-picker',
  idleHint: 'Move over rendered DOM (file:startLine:endLine)',
})
```
