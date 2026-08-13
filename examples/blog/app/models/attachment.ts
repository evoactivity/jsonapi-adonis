import { AttachmentSchema } from '#database/schema'

/**
 * The base of a single-table inheritance family: images and videos share
 * the attachments table, told apart by the kind column. Application code
 * uses the subclasses; relations that can hold either target this base.
 */
export default class Attachment extends AttachmentSchema {}

export class Image extends Attachment {
  static table = 'attachments'
}

export class Video extends Attachment {
  static table = 'attachments'
}
