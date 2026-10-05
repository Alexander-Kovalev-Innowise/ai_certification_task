import { Exclude, Expose } from 'class-transformer';

// US-01.11. `url` is the 512px photo, `thumbnailUrl` the 128px thumbnail; the
// caller PATCHes `url` as `photoUrl` onto /me or a player profile.
@Exclude()
export class UploadPhotoResponseDto {
  @Expose() url!: string;
  @Expose() thumbnailUrl!: string;
}
