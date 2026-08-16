import { Image } from '#models/attachment'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

export default class ImageResource extends JsonApiResource<Image> {
  static type = 'images'
  static model = () => Image
}
