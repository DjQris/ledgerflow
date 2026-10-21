import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export const TEST_OWNER_REFERENCE_PATTERN =
  /^test-[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

export class CreateWalletDto {
  @ApiProperty({
    description:
      'Stable simulated owner identifier. Real customer information is not accepted in this phase.',
    example: 'test-alice',
    maxLength: 100,
    pattern: TEST_OWNER_REFERENCE_PATTERN.source,
  })
  @IsString()
  @MaxLength(100)
  @Matches(TEST_OWNER_REFERENCE_PATTERN, {
    message:
      'ownerReference must be a lowercase simulated identifier beginning with test-',
  })
  ownerReference!: string;
}
