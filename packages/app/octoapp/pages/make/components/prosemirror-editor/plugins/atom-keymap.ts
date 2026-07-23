import { keymap } from "prosemirror-keymap"
import { TextSelection } from "prosemirror-state"

export const atomKeymap = keymap({
  Backspace: (state, dispatch) => {
    const { selection } = state
    
    if (!selection.empty) {
      if (dispatch) {
        dispatch(state.tr.deleteSelection())
      }
      return true
    }
    
    if (selection instanceof TextSelection && selection.$cursor) {
      const pos = selection.$cursor.pos
      const nodeBefore = state.doc.nodeAt(pos - 1)
      if (nodeBefore?.type.spec.atom) {
        if (dispatch) {
          dispatch(state.tr.delete(pos - 1, pos))
        }
        return true
      }
    }
    
    return false
  },
  
  Delete: (state, dispatch) => {
    const { selection } = state
    
    if (!selection.empty) {
      if (dispatch) {
        dispatch(state.tr.deleteSelection())
      }
      return true
    }
    
    if (selection instanceof TextSelection && selection.$cursor) {
      const pos = selection.$cursor.pos
      const nodeAfter = state.doc.nodeAt(pos)
      if (nodeAfter?.type.spec.atom) {
        if (dispatch) {
          dispatch(state.tr.delete(pos, pos + 1))
        }
        return true
      }
    }
    
    return false
  },
})