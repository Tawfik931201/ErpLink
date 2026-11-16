import { buildOdooValues as buildValues } from './build-values'
import { executeOdooOperation as executeOperation } from './execute-operation'
import type { ExecuteOdooParams } from './operation-types'
import { bindOdooProductBom, type SyncMissingProduct } from './product-bom'
import { bindOdooRelations } from './relations'

export function createOdooOperations(syncMissingProduct: SyncMissingProduct) {
  const syncProductBom = bindOdooProductBom(syncMissingProduct)
  const resolveSingleRelationId = bindOdooRelations(executeOdooOperation)
  const buildOdooValues = buildValues.bind(null, resolveSingleRelationId)

  function executeOdooOperation(params: ExecuteOdooParams) {
    return executeOperation(params, { syncProductBom, resolveSingleRelationId })
  }

  return { resolveSingleRelationId, buildOdooValues, executeOdooOperation, syncProductBom }
}
