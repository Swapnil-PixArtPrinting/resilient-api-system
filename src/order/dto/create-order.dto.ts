import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from "class-validator";

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsString()
  @IsOptional()
  currency?: string;
}
