import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { S3StorageAdapter } from './s3-storage.adapter';

/**
 * Adaptador S3-compatible (producción: AWS S3, R2, B2, MinIO).
 *
 * Lo que se verifica es el contrato con el storage —qué bucket y qué clave se
 * usan, qué se devuelve cuando algo falla— y no el SDK en sí: un adaptador que
 * lance excepciones donde el caller espera `null` rompería el voucher en
 * silencio (el caso «la firma ya no está en el storage»).
 */
describe('S3StorageAdapter', () => {
  const config = {
    endpoint: 'https://s3.example.com',
    region: 'us-east-1',
    bucket: 'ruta-clara-archivos',
    accessKeyId: 'clave-test',
    secretAccessKey: 'secreto-test',
    forcePathStyle: true,
  };

  function clienteFalso(respuestas: Record<string, unknown>) {
    const comandos: Array<{ nombre: string; input: Record<string, unknown> }> = [];
    const cliente = {
      send: async (comando: { constructor: { name: string }; input: Record<string, unknown> }) => {
        comandos.push({ nombre: comando.constructor.name, input: comando.input });
        const clave = comando.constructor.name.replace('Command', '');
        if (clave in respuestas) return respuestas[clave];
        throw Object.assign(new Error('No encontrado'), { name: 'NotFound' });
      },
    } as unknown as S3Client;
    return { cliente, comandos };
  }

  it('exige un bucket configurado', () => {
    assert.throws(() => new S3StorageAdapter({}), /falta S3_BUCKET/);
  });

  it('put sube el buffer con la clave, el bucket y el MIME correctos', async () => {
    const { cliente, comandos } = clienteFalso({ PutObject: {} });
    const almacen = new S3StorageAdapter(config, cliente);

    await almacen.put('firma_cliente/archivo.bin', Buffer.from('hola'), 'image/png');

    assert.equal(comandos.length, 1);
    assert.equal(comandos[0].nombre, 'PutObjectCommand');
    assert.equal(comandos[0].input.Bucket, 'ruta-clara-archivos');
    assert.equal(comandos[0].input.Key, 'firma_cliente/archivo.bin');
    assert.equal(comandos[0].input.ContentType, 'image/png');
    assert.deepEqual(comandos[0].input.Body, Buffer.from('hola'));
  });

  it('getBuffer devuelve el contenido de la respuesta', async () => {
    const { cliente } = clienteFalso({
      GetObject: { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } },
    });
    const almacen = new S3StorageAdapter(config, cliente);

    const buffer = await almacen.getBuffer('vouchers/abc.pdf');

    assert.ok(Buffer.isBuffer(buffer));
    assert.deepEqual([...buffer], [1, 2, 3]);
  });

  it('getBuffer lanza si el objeto viene sin cuerpo', async () => {
    const { cliente } = clienteFalso({ GetObject: { Body: undefined } });
    const almacen = new S3StorageAdapter(config, cliente);

    await assert.rejects(() => almacen.getBuffer('vouchers/abc.pdf'), /sin cuerpo/);
  });

  it('head devuelve el tamaño cuando el objeto existe', async () => {
    const { cliente } = clienteFalso({ HeadObject: { ContentLength: 12734 } });
    const almacen = new S3StorageAdapter(config, cliente);

    assert.deepEqual(await almacen.head('firma_cliente/a.bin'), { size: 12734 });
  });

  it('head devuelve null cuando el objeto no está (no lanza)', async () => {
    const { cliente } = clienteFalso({});
    const almacen = new S3StorageAdapter(config, cliente);

    assert.equal(await almacen.head('firma_cliente/perdido.bin'), null);
  });

  it('delete elimina la clave del bucket', async () => {
    const { cliente, comandos } = clienteFalso({ DeleteObject: {} });
    const almacen = new S3StorageAdapter(config, cliente);

    await almacen.delete('firma_cliente/a.bin');

    assert.equal(comandos[0].nombre, 'DeleteObjectCommand');
    assert.equal(comandos[0].input.Key, 'firma_cliente/a.bin');
  });

  it('signedDownloadUrl devuelve una URL firmada con expiración', async () => {
    // Cliente real con credenciales de prueba: el presigner sólo firma, no
    // hace red, así que esto no toca ningún bucket.
    const real = new S3Client({
      region: 'us-east-1',
      endpoint: 'https://s3.example.com',
      forcePathStyle: true,
      credentials: { accessKeyId: 'clave-test', secretAccessKey: 'secreto-test' },
    });
    const almacen = new S3StorageAdapter(config, real);

    const url = await almacen.signedDownloadUrl('firma_cliente/a.bin', 120);

    assert.match(url, /^https:\/\/s3\.example\.com\/ruta-clara-archivos\/firma_cliente\/a\.bin/);
    assert.match(url, /X-Amz-Signature=/);
    assert.match(url, /X-Amz-Expires=120/);
  });
});
