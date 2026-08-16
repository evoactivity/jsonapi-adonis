import Attachment from '#models/attachment'
import ImageResource from '#resources/image_resource'
import VideoResource from '#resources/video_resource'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

/**
 * The base resource of the STI family. resolveResource maps a row to its
 * concrete resource by the discriminator; subtypes is the set of types a
 * relation targeting Attachment accepts on writes. Registering this base
 * registers both subtype resources with it.
 */
export default class AttachmentResource extends JsonApiResource<Attachment> {
  static model = () => Attachment
  static subtypes = () => [ImageResource, VideoResource]
  static resolveResource(row: Attachment) {
    return { image: ImageResource, video: VideoResource }[row.kind]
  }
}
