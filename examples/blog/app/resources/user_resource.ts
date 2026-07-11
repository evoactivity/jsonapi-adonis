import User from '#models/user'
import { JsonApiResource } from '@evoactivity/jsonapi-adonis'

export default class UserResource extends JsonApiResource<User> {
  static type = 'users'
  static model = () => User

  attributes() {
    // Expose a curated attribute set instead of every column
    return {
      ...this.pick(['fullName', 'email']),
      initials: this.resource.initials,
    }
  }
}
