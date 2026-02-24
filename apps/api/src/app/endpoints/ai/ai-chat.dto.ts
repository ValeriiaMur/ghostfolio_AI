import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AiChatDto {
  @IsNotEmpty()
  @IsString()
  query: string;

  @IsOptional()
  @IsString()
  sessionId?: string;
}
