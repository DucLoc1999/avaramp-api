import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_S3_REGION || 'ap-southeast-1',
  endpoint: process.env.AWS_S3_ENDPOINT || undefined,
  forcePathStyle: !!process.env.AWS_S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const bucket = process.env.AWS_S3_BUCKET || '';

export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string = 'image/jpeg',
): Promise<string> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  if (process.env.AWS_S3_ENDPOINT) {
    return `${process.env.AWS_S3_ENDPOINT}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${process.env.AWS_S3_REGION || 'ap-southeast-1'}.amazonaws.com/${key}`;
}

export async function uploadBase64Image(
  base64Data: string,
  key: string,
  contentType: string = 'image/jpeg',
): Promise<string> {
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Clean, 'base64');

  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  if (process.env.AWS_S3_ENDPOINT) {
    return `${process.env.AWS_S3_ENDPOINT}/${bucket}/${key}`;
  }
  return `https://${bucket}.s3.${process.env.AWS_S3_REGION || 'ap-southeast-1'}.amazonaws.com/${key}`;
}
