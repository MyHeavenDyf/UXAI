import { createStore } from "solid-js/store"

export type FeatureState = {
  editing: boolean
  modelEditing: boolean
  drawing: boolean
  commenting: boolean
  archiving: boolean
  inspecting: boolean
}

export function useFeatureMutex(initialState?: Partial<FeatureState>) {
  const [state, setState] = createStore<FeatureState>({
    editing: false,
    modelEditing: false,
    drawing: false,
    commenting: false,
    archiving: false,
    inspecting: false,
    ...initialState,
  })

  const enableFeature = (feature: keyof FeatureState) => {
    setState({
      editing: feature === 'editing',
      modelEditing: feature === 'modelEditing',
      drawing: feature === 'drawing',
      commenting: feature === 'commenting',
      archiving: feature === 'archiving',
      inspecting: feature === 'inspecting',
    })
  }

  const toggleFeature = (feature: keyof FeatureState) => {
    if (state[feature]) {
      setState(feature, false)
    } else {
      enableFeature(feature)
    }
  }

  const disableAll = () => {
    setState({
      editing: false,
      modelEditing: false,
      drawing: false,
      commenting: false,
      archiving: false,
      inspecting: false,
    })
  }

  return {
    state,
    enableFeature,
    toggleFeature,
    disableAll,
  }
}