import { Operation } from 'rfc6902';
import { ILokiObj } from './loki-obj';

export interface IMutation extends ILokiObj {
  /**
   * Save changes to collection: if set, save this object,
   * except the `saveChanges` property, to the `saveChanges` collection
   */
  saveChanges?: string;
  /** RFC6902 JSON patch */
  patch?: Operation[];
}
