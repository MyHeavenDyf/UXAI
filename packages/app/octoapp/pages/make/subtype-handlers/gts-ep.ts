import type { SubtypeHandler } from './types'
import type { ModelEditConfig } from '../components/model-edit-items/types'
import gtsHandler, { gtsModelEditConfig } from './gts'
import { directModelEditConfig } from './default'

const gtsEpModelEditConfig: ModelEditConfig = {
  ...gtsModelEditConfig,
  iconConfig: directModelEditConfig.iconConfig,
}

const gtsEpHandler: SubtypeHandler = {
  ...gtsHandler,
  name: 'gts-ep',
  modelEditConfig: gtsEpModelEditConfig,
}

export default gtsEpHandler
