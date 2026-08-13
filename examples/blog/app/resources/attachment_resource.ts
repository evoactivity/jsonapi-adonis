import Attachment, { Image, Video } from '#models/attachment'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

export class ImageResource extends JsonApiResource<Image> {
  static type = 'images'
  static model = () => Image
}

export class VideoResource extends JsonApiResource<Video> {
  static type = 'videos'
  static model = () => Video
}

/**
 * The base resource of the STI family. resolveResource maps a row to its
 * concrete resource by the discriminator; subtypes is the set of types a
 * relation targeting Attachment accepts on writes.
 */
export default class AttachmentResource extends JsonApiResource<Attachment> {
  static model = () => Attachment
  static subtypes = () => [ImageResource, VideoResource]
  static resolveResource(row: Attachment) {
    return { image: ImageResource, video: VideoResource }[row.kind]
  }
}
