import vine from '@vinejs/vine'

export const createArticleValidator = vine.create({
  title: vine.string().minLength(3),
  body: vine.string(),
  authorId: vine.number(),
})

export const updateArticleValidator = vine.create({
  title: vine.string().minLength(3).optional(),
  body: vine.string().optional(),
  authorId: vine.number().optional(),
})
