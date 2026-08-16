import { Video } from '#models/attachment'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

export default class VideoResource extends JsonApiResource<Video> {
  static type = 'videos'
  static model = () => Video
}
