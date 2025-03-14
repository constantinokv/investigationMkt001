// Estructura de una API RESTful para la edición de imágenes de eCommerce
// Usando Express.js para el backend y Sharp para el procesamiento de imágenes

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const cors = require('cors');
//const axios = require('axios');
const winston = require('winston');
const fs = require('fs-extra');
const { exec } = require('child_process');
const ipStats = new Map();
const FormData = require('form-data');
const fetch = require('node-fetch');






// Configurar logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Verificar que rembg está instalado al iniciar
exec('rembg --version', (error, stdout, stderr) => {
    if (error) {
        logger.error('rembg no está instalado o accesible', {
            error: error.message,
            stderr
        });
    } else {
        logger.info('rembg verificado correctamente', { version: stdout.trim() });
    }
});

// Verificar GPU al iniciar el servidor
exec('nvidia-smi', (error, stdout, stderr) => {
    if (error) {
        logger.warn('No se detectó GPU NVIDIA o nvidia-smi', {
            error: error.message
        });
    } else {
        logger.info('GPU NVIDIA detectada', {
            info: stdout.trim()
        });
    }
});


// Configuración de la aplicación
const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // Límite de 10MB
});

app.use(express.static('public'));


// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use('/processed', express.static('processed'));

// Middleware para monitorear todas las peticiones
app.use((req, res, next) => {
    logger.info('Nueva petición', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent')
    });
    next();
});

// Middleware para tracking de uso
app.use((req, res, next) => {
    const startTime = Date.now();
    const userIP = req.ip;

    // Inicializar estadísticas para esta IP si no existen
    if (!ipStats.has(userIP)) {
        ipStats.set(userIP, {
            totalRequests: 0,
            totalBytes: 0,
            lastAccess: new Date(),
            uploads: 0
        });
    }

    // Actualizar contador
    const stats = ipStats.get(userIP);
    stats.totalRequests++;
    stats.lastAccess = new Date();

    logger.info('Nueva petición', {
        // Logs básicos
        method: req.method,
        path: req.path,
        ip: userIP,
        
        // Estadísticas acumuladas
        stats: {
            requestCount: stats.totalRequests,
            totalUploadedMB: (stats.totalBytes / (1024 * 1024)).toFixed(2),
            lastAccess: stats.lastAccess
        }
    });

    // Cuando termina la petición
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        
        // Actualizar bytes si hay archivo
        if (req.file) {
            stats.totalBytes += req.file.size;
            stats.uploads++;
        }

        logger.info('Petición completada', {
            ip: userIP,
            duracionMs: duration,
            statsActualizados: {
                totalUploads: stats.uploads,
                totalMB: (stats.totalBytes / (1024 * 1024)).toFixed(2)
            }
        });
    });

    next();
});

// Endpoint para ver estadísticas (solo desarrollo)
app.get('/debug/stats', (req, res) => {
    const allStats = Array.from(ipStats.entries()).map(([ip, stats]) => ({
        ip,
        ...stats,
        totalMB: (stats.totalBytes / (1024 * 1024)).toFixed(2)
    }));
    
    res.json(allStats);
});


// Crear directorios si no existen
const dirs = ['uploads', 'processed', 'templates'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Ruta para cargar una imagen
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
  }
  
  const filename = Date.now() + path.extname(req.file.originalname);
  const filepath = path.join('uploads', filename);
  
  fs.writeFileSync(filepath, req.file.buffer);
  
  res.json({
    success: true,
    filename,
    path: `/uploads/${filename}`,
    message: 'Imagen subida correctamente'
  });
});


// Función helper para medir rendimiento
const measurePerformance = (startTime) => {
  const endTime = Date.now();
  return {
      totalTime: endTime - startTime,
      timestamp: new Date().toISOString()
  };
};

 
 

// Configuración de Azure Computer Vision
const AZURE_CONFIG = {
  endpoint: 'https://vision-background.cognitiveservices.azure.com',
  key: 'GJIyxNvP9HaZSE6Q1RSslvLYgEdfG26h5rHnGYJynMbOQ56XlSrQJQQJ99BCACYeBjFXJ3w3AAAFACOGSbzP'
};

app.post('/api/remove-background-azure', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  const requestId = Date.now().toString();
  let outputPath;

  try {
      if (!req.file) {
          return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
      }

      logger.info('Iniciando proceso Azure Computer Vision', {
          requestId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype
      });

      // Normalizar la imagen a PNG usando Sharp
      let imageBuffer;
      try {
          imageBuffer = await sharp(req.file.buffer)
              .toFormat('png')
              .toBuffer();
          
          logger.info('Imagen normalizada a PNG', {
              requestId,
              originalSize: req.file.buffer.length,
              normalizedSize: imageBuffer.length
          });
      } catch (sharpError) {
          logger.error('Error al normalizar imagen', {
              requestId,
              error: sharpError.message
          });
          throw new Error('Error al procesar el formato de la imagen');
      }

      // URL actualizada según documentación oficial de Azure
      const apiUrl = `${AZURE_CONFIG.endpoint}/computervision/imageanalysis:segment?api-version=2023-02-01-preview&mode=backgroundRemoval`;

      logger.info('Configuración de llamada a Azure', {
          requestId,
          url: apiUrl
      });

      // Llamada REST directa usando fetch
      const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/octet-stream',
              'Ocp-Apim-Subscription-Key': AZURE_CONFIG.key
          },
          body: imageBuffer
      });

      if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error en Azure API: ${response.status} ${response.statusText} - ${errorText}`);
      }

      // Verificar que la respuesta es una imagen PNG
      const contentType = response.headers.get('content-type');
      if (contentType !== 'image/png') {
          throw new Error(`Respuesta inesperada de Azure: ${contentType}`);
      }

      // Obtener el buffer de la imagen resultante
      const resultBuffer = await response.arrayBuffer();

      // Guardar la imagen resultante
      const outputFilename = `azure-${requestId}.png`;
      outputPath = path.join('processed', outputFilename);
      
      logger.info('Guardando imagen procesada', {
          requestId,
          outputPath,
          responseSize: resultBuffer.byteLength,
          contentType: contentType
      });

      await fs.writeFile(outputPath, Buffer.from(resultBuffer));

      // Obtener información del archivo guardado
      const fileStats = await fs.stat(outputPath);
      const processTime = Date.now() - startTime;
      const memoryUsage = process.memoryUsage();

      // Log detallado del proceso completado
      logger.info('Proceso Azure completado', {
          requestId,
          performance: {
              processTimeMs: processTime,
              memoryUsage: {
                  heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
                  external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB',
                  rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB'
              }
          },
          file: {
              path: outputPath,
              size: fileStats.size,
              created: fileStats.birthtime,
              sizeReduction: `${Math.round((req.file.size - fileStats.size) / req.file.size * 100)}%`
          },
          timing: {
              started: new Date(startTime).toISOString(),
              completed: new Date().toISOString(),
              duration: `${processTime}ms`
          },
          azureApiVersion: '2023-02-01-preview'
      });

      res.json({
          success: true,
          path: `/processed/${outputFilename}`,
          message: 'Fondo removido correctamente con Azure',
          stats: {
              processTime: `${processTime}ms`,
              originalSize: req.file.size,
              processedSize: fileStats.size,
              reduction: `${Math.round((req.file.size - fileStats.size) / req.file.size * 100)}%`
          }
      });

  } catch (error) {
      const errorTime = Date.now();
      logger.error('Error en proceso Azure', {
          requestId,
          timing: {
              started: new Date(startTime).toISOString(),
              error: new Date(errorTime).toISOString(),
              duration: `${errorTime - startTime}ms`
          },
          error: {
              message: error.message,
              stack: error.stack,
              name: error.name
          },
          request: {
              fileName: req.file?.originalname,
              fileSize: req.file?.size,
              contentType: req.file?.mimetype
          }
      });

      // Limpiar archivo temporal si existe
      if (outputPath) {
          try {
              if (await fs.pathExists(outputPath)) {
                  await fs.unlink(outputPath);
                  logger.info('Archivo temporal eliminado después de error', {
                      requestId,
                      path: outputPath
                  });
              }
          } catch (cleanupError) {
              logger.warn('Error al limpiar archivo temporal', {
                  requestId,
                  error: cleanupError.message
              });
          }
      }

      res.status(500).json({
          error: 'Error al procesar la imagen con Azure',
          details: error.message,
          requestId,
          timestamp: new Date().toISOString()
      });
  }
});


// 1. Remover fondo de imagen
app.post('/api/remove-background', upload.single('image'), async (req, res) => {
  const requestId = Date.now().toString();
  const metrics = {
      startTime: Date.now(),
      imagePreprocess: 0,
      backgroundRemoval: 0,
      cleanup: 0,
      memory: {
          start: process.memoryUsage(),
          end: null,
          delta: null
      }
  };

  try {
      // Validar archivo
      if (!req.file) {
          logger.warn('Intento de procesamiento sin imagen', { requestId });
          return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
      }

      // Logging información inicial
      logger.info('Iniciando procesamiento', {
          requestId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          startMemory: metrics.memory.start
      });

      // Crear directorios si no existen
      await fs.ensureDir('uploads');
      await fs.ensureDir('processed');

      const inputPath = path.join('uploads', `temp-${requestId}.png`);
      const outputFilename = `nobg-${requestId}.png`;
      const outputPath = path.join('processed', outputFilename);

      // Medir preprocesamiento con Sharp
      const preprocessStart = Date.now();
      try {
          await sharp(req.file.buffer)
              .png()
              .toFile(inputPath);
          metrics.imagePreprocess = Date.now() - preprocessStart;
          logger.info('Preprocesamiento completado', { 
              requestId, 
              preprocessTime: metrics.imagePreprocess,
              path: inputPath 
          });
      } catch (sharpError) {
          logger.error('Error en preprocesamiento', {
              requestId,
              error: sharpError.message,
              preprocessTime: Date.now() - preprocessStart
          });
          throw new Error('Error al procesar la imagen inicial');
      }

      // Ejecutar rembg con timeout y medición
      const rembgStart = Date.now();
      try {
          await new Promise((resolve, reject) => {
              const rembgProcess = exec(
                  `rembg i "${inputPath}" "${outputPath}"`,
                  { timeout: 30000 },
                  (error, stdout, stderr) => {
                      metrics.backgroundRemoval = Date.now() - rembgStart;
                      if (error) {
                          logger.error('Error en rembg', {
                              requestId,
                              error: error.message,
                              stderr,
                              rembgTime: metrics.backgroundRemoval
                          });
                          reject(error);
                      } else {
                          logger.info('rembg ejecutado correctamente', {
                              requestId,
                              rembgTime: metrics.backgroundRemoval,
                              stdout: stdout || 'No output'
                          });
                          resolve();
                      }
                  }
              );

              // Monitorear memoria durante rembg
              rembgProcess.on('close', () => {
                  metrics.memory.end = process.memoryUsage();
                  metrics.memory.delta = {
                      heapUsed: metrics.memory.end.heapUsed - metrics.memory.start.heapUsed,
                      external: metrics.memory.end.external - metrics.memory.start.external,
                      rss: metrics.memory.end.rss - metrics.memory.start.rss
                  };
                  
                  logger.info('Métricas de memoria rembg', {
                      requestId,
                      memoryStart: metrics.memory.start,
                      memoryEnd: metrics.memory.end,
                      memoryDelta: metrics.memory.delta
                  });
              });
          });
      } catch (rembgError) {
          throw new Error(`Error en rembg: ${rembgError.message}`);
      }

      // Verificar archivo de salida
      if (!await fs.pathExists(outputPath)) {
          throw new Error('El archivo de salida no fue generado');
      }

      // Medir limpieza
      const cleanupStart = Date.now();
      try {
          await fs.unlink(inputPath);
          metrics.cleanup = Date.now() - cleanupStart;
          logger.info('Limpieza completada', { 
              requestId, 
              cleanupTime: metrics.cleanup,
              path: inputPath 
          });
      } catch (unlinkError) {
          logger.warn('Error en limpieza', {
              requestId,
              error: unlinkError.message,
              cleanupTime: Date.now() - cleanupStart
          });
      }

      // Calcular y registrar métricas finales
      const totalTime = Date.now() - metrics.startTime;
      const finalMetrics = {
          requestId,
          totalTime,
          preprocessing: metrics.imagePreprocess,
          backgroundRemoval: metrics.backgroundRemoval,
          cleanup: metrics.cleanup,
          memory: metrics.memory,
          imageInfo: {
              originalSize: req.file.size,
              processedSize: (await fs.stat(outputPath)).size
          }
      };

      logger.info('Proceso completado', {
          ...finalMetrics,
          outputPath
      });

      // Respuesta al cliente
      res.json({
          success: true,
          path: `/processed/${outputFilename}`,
          message: 'Fondo removido correctamente',
          metrics: {
              totalTime: `${totalTime}ms`,
              preprocessing: `${metrics.imagePreprocess}ms`,
              backgroundRemoval: `${metrics.backgroundRemoval}ms`,
              cleanup: `${metrics.cleanup}ms`,
              memoriaUsada: `${(metrics.memory.delta.heapUsed / 1024 / 1024).toFixed(2)}MB`
          }
      });

  } catch (error) {
      logger.error('Error en el proceso', {
          requestId,
          error: error.message,
          stack: error.stack,
          metrics: {
              tiempoHastaError: Date.now() - metrics.startTime,
              memoriaAlError: process.memoryUsage()
          }
      });

      // Limpiar archivos en caso de error
      try {
          await fs.remove(inputPath);
          await fs.remove(outputPath);
      } catch (cleanupError) {
          logger.error('Error en limpieza post-error', {
              requestId,
              error: cleanupError.message
          });
      }

      res.status(500).json({
          error: 'Error al procesar la imagen',
          details: error.message,
          requestId
      });
  }
});

//1.1 PhotoRoom
// Configuración de PhotoRoom
const PHOTOROOM_CONFIG = {
  sandbox: {
      apiKey: 'sandbox_faeaa2b206df9ba9fe5f25841a3186efc1462f65',
      endpoint: 'https://image-api.photoroom.com/v2/edit' // Nueva URL
  },
  production: {
      apiKey: 'faeaa2b206df9ba9fe5f25841a3186efc1462f65',
      endpoint: 'https://image-api.photoroom.com/v2/edit' // Nueva URL
  }
};

app.post('/api/remove-background-photoroom', upload.single('image'), async (req, res) => {
  const startTime = Date.now();
  const requestId = Date.now().toString();
  const mode = req.body.mode || 'sandbox';

  try {
      logger.info('Iniciando proceso PhotoRoom', {
          requestId,
          mode,
          fileName: req.file.originalname,
          fileSize: req.file.size
      });

      const formData = new FormData();
      // Cambio en el nombre del campo de 'image_file' a 'imageFile'
      formData.append('imageFile', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
      });

      logger.info('Llamando a API PhotoRoom', {
          requestId,
          endpoint: PHOTOROOM_CONFIG[mode].endpoint,
          mode: mode
      });

      // Llamada a PhotoRoom API con los nuevos headers
      const response = await fetch(PHOTOROOM_CONFIG[mode].endpoint, {
          method: 'POST',
          headers: {
              'x-api-key': PHOTOROOM_CONFIG[mode].apiKey,
              'pr-background-removal-model-version': '2024-09-26' // Usando el modelo más reciente
          },
          body: formData
      });

      if (!response.ok) {
          const errorText = await response.text();
          logger.error('Error en respuesta de PhotoRoom', {
              requestId,
              status: response.status,
              statusText: response.statusText,
              errorBody: errorText
          });
          throw new Error(`Error en PhotoRoom API: ${response.status} - ${errorText}`);
      }

      const buffer = await response.buffer();
      const outputFilename = `photoroom-${requestId}.png`;
      const outputPath = path.join('processed', outputFilename);

      await fs.writeFile(outputPath, buffer);

      const processTime = Date.now() - startTime;
      logger.info('Proceso PhotoRoom completado', {
          requestId,
          processTimeMs: processTime,
          outputPath,
          remainingCredits: response.headers.get('x-credits-remaining')
      });

      res.json({
          success: true,
          path: `/processed/${outputFilename}`,
          message: 'Fondo removido correctamente con PhotoRoom',
          processTime: `${processTime}ms`,
          remainingCredits: response.headers.get('x-credits-remaining'),
          modelVersion: '2024-09-26'
      });

  } catch (error) {
      logger.error('Error en proceso PhotoRoom', {
          requestId,
          error: error.message
      });

      res.status(500).json({
          error: 'Error al procesar la imagen con PhotoRoom',
          details: error.message,
          requestId
      });
  }
});


// 2. Redimensionar imagen
app.post('/api/resize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }
    
    const { width, height, fit = 'contain' } = req.body;
    
    if (!width && !height) {
      return res.status(400).json({ error: 'Se requiere especificar ancho o alto' });
    }
    
    const outputFilename = `resized-${Date.now()}.png`;
    const outputPath = path.join('processed', outputFilename);
    
    await sharp(req.file.buffer)
      .resize({
        width: width ? parseInt(width) : null,
        height: height ? parseInt(height) : null,
        fit: fit
      })
      .toFile(outputPath);
      
    res.json({
      success: true,
      path: `/processed/${outputFilename}`,
      message: 'Imagen redimensionada correctamente'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Crear imágenes Hero
app.post('/api/create-hero', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }
    
    const { 
      title, 
      description, 
      price,
      brandColor = '#000000',
      templateId = 'default'
    } = req.body;
    
    // Dimensiones para la imagen hero
    const width = 1200;
    const height = 628;
    
    const outputFilename = `hero-${Date.now()}.png`;
    const outputPath = path.join('processed', outputFilename);
    
    // Crear un canvas para la imagen hero
    // Lado izquierdo: producto
    // Lado derecho: información de marca y producto
    
    // Procesar la imagen principal
    const productBuffer = await sharp(req.file.buffer)
      .resize({ 
        width: width / 2, 
        height: height,
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 }
      })
      .toBuffer();
    
    // Crear el fondo para la información
    const textSideBuffer = await sharp({
      create: {
        width: width / 2,
        height: height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
    .png()
    .toBuffer();
    
    // Combinar ambas partes
    await sharp({
      create: {
        width: width,
        height: height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    })
    .composite([
      { input: productBuffer, left: 0, top: 0 },
      { input: textSideBuffer, left: width / 2, top: 0 }
    ])
    .toFile(outputPath);
    
    // Nota: Para una implementación real, se usaría un servicio
    // para generar texto sobre la imagen o SVG
    
    res.json({
      success: true,
      path: `/processed/${outputFilename}`,
      message: 'Imagen hero creada correctamente'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Generar imágenes ambientadas
app.post('/api/create-lifestyle', upload.fields([
    { name: 'product', maxCount: 1 },
    { name: 'background', maxCount: 1 }
]), async (req, res) => {
    try {
        if (!req.files || !req.files.product || !req.files.background) {
            return res.status(400).json({ error: 'Se requieren ambas imágenes' });
        }
        
        const outputFilename = `lifestyle-${Date.now()}.png`; // Cambiado a PNG para mantener transparencia
        const outputPath = path.join('processed', outputFilename);
        
        // Procesar la imagen del producto manteniendo la transparencia
        const productBuffer = await sharp(req.files.product[0].buffer)
            .resize({ 
                width: 800, // Aumentado el tamaño para mejor calidad
                height: 800,
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 } // Fondo completamente transparente
            })
            .png() // Forzar formato PNG para mantener transparencia
            .toBuffer();
        
        // Procesar el fondo
        const backgroundBuffer = await sharp(req.files.background[0].buffer)
            .resize({ 
                width: 1920, 
                height: 1080,
                fit: 'cover'
            })
            .toBuffer();
        
        // Combinar las imágenes manteniendo la transparencia
        await sharp(backgroundBuffer)
            .composite([
                { 
                    input: productBuffer,
                    gravity: 'center',
                    blend: 'over' // Modo de fusión que respeta la transparencia
                }
            ])
            .png() // Mantener como PNG para la transparencia
            .toFile(outputPath);
        
        res.json({
            success: true,
            path: `/processed/${outputFilename}`,
            message: 'Imagen ambientada creada correctamente'
        });
    } catch (error) {
        console.error('Error en create-lifestyle:', error);
        res.status(500).json({ error: error.message });
    }
});

// 5. Crear imágenes isométricas con dimensiones
app.post('/api/create-isometric', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }
    
    const { 
      width: productWidth, 
      height: productHeight, 
      depth: productDepth,
      unit = 'cm'
    } = req.body;
    
    if (!productWidth || !productHeight || !productDepth) {
      return res.status(400).json({ 
        error: 'Se requieren las dimensiones del producto (ancho, alto, profundidad)' 
      });
    }
    
    const outputFilename = `isometric-${Date.now()}.png`;
    const outputPath = path.join('processed', outputFilename);
    
    // En una implementación real:
    // 1. Transformar la imagen para darle perspectiva isométrica
    // 2. Añadir líneas de dimensión y texto
    
    // Procesamiento simple para ejemplo
    await sharp(req.file.buffer)
      .resize({ width: 800, height: 600, fit: 'contain' })
      .toFile(outputPath);
    
    res.json({
      success: true,
      path: `/processed/${outputFilename}`,
      message: 'Imagen isométrica creada correctamente'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Optimizar y comprimir imágenes
app.post('/api/optimize', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }
    
    const { quality = 80, format = 'webp' } = req.body;
    
    const outputFilename = `optimized-${Date.now()}.${format}`;
    const outputPath = path.join('processed', outputFilename);
    
    let sharpInstance = sharp(req.file.buffer);
    
    switch (format.toLowerCase()) {
      case 'jpeg':
      case 'jpg':
        sharpInstance = sharpInstance.jpeg({ quality: parseInt(quality) });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({ quality: parseInt(quality) });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({ quality: parseInt(quality) });
        break;
      case 'avif':
        sharpInstance = sharpInstance.avif({ quality: parseInt(quality) });
        break;
      default:
        sharpInstance = sharpInstance.webp({ quality: parseInt(quality) });
    }
    
    await sharpInstance.toFile(outputPath);
    
    const originalSize = req.file.size;
    const optimizedSize = fs.statSync(outputPath).size;
    const savingsPercent = ((originalSize - optimizedSize) / originalSize * 100).toFixed(2);
    
    res.json({
      success: true,
      path: `/processed/${outputFilename}`,
      originalSize,
      optimizedSize,
      savings: `${savingsPercent}%`,
      message: 'Imagen optimizada correctamente'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Ajustar color, brillo, nitidez
app.post('/api/adjust', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se ha subido ninguna imagen' });
    }
    
    const { 
      brightness = 1, 
      saturation = 1, 
      hue = 0,
      sharpness = 1,
      contrast = 1
    } = req.body;
    
    const outputFilename = `adjusted-${Date.now()}.png`;
    const outputPath = path.join('processed', outputFilename);
    
    await sharp(req.file.buffer)
      .modulate({
        brightness: parseFloat(brightness),
        saturation: parseFloat(saturation),
        hue: parseInt(hue)
      })
      .sharpen(parseFloat(sharpness))
      .gamma(parseFloat(contrast))
      .toFile(outputPath);
    
    res.json({
      success: true,
      path: `/processed/${outputFilename}`,
      message: 'Ajustes aplicados correctamente'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Procesamiento en lote
app.post('/api/batch-process', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se han subido imágenes' });
    }
    
    const { operations } = req.body;
    
    if (!operations) {
      return res.status(400).json({ error: 'Se requiere especificar las operaciones a realizar' });
    }
    
    // Procesar operaciones en formato JSON
    const operationsArray = JSON.parse(operations);
    const results = [];
    
    for (const file of req.files) {
      let currentBuffer = file.buffer;
      
      for (const operation of operationsArray) {
        switch (operation.type) {
          case 'resize':
            currentBuffer = await sharp(currentBuffer)
              .resize({
                width: operation.width ? parseInt(operation.width) : null,
                height: operation.height ? parseInt(operation.height) : null,
                fit: operation.fit || 'contain'
              })
              .toBuffer();
            break;
          case 'remove-background':
            // Simulación del proceso
            currentBuffer = await sharp(currentBuffer)
              .png()
              .toBuffer();
            break;
          case 'optimize':
            currentBuffer = await sharp(currentBuffer)
              .webp({ quality: operation.quality ? parseInt(operation.quality) : 80 })
              .toBuffer();
            break;
          case 'adjust':
            currentBuffer = await sharp(currentBuffer)
              .modulate({
                brightness: operation.brightness ? parseFloat(operation.brightness) : 1,
                saturation: operation.saturation ? parseFloat(operation.saturation) : 1,
                hue: operation.hue ? parseInt(operation.hue) : 0
              })
              .toBuffer();
            break;
        }
      }
      
      // Guardar el resultado final
      const outputFilename = `batch-${Date.now()}-${results.length}.png`;
      const outputPath = path.join('processed', outputFilename);
      
      await sharp(currentBuffer).toFile(outputPath);
      
      results.push({
        originalName: file.originalname,
        processedPath: `/processed/${outputFilename}`
      });
    }
    
    res.json({
      success: true,
      results,
      message: `${results.length} imágenes procesadas correctamente`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para estadísticas (debe ir antes de app.listen)
app.get('/stats', async (req, res) => {
  try {
      // Verificar si el archivo de logs existe
      if (!await fs.pathExists('combined.log')) {
          return res.send(`
              <html>
              <head>
                  <title>Estadísticas de Procesamiento</title>
                  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
              </head>
              <body>
                  <div class="container mt-4">
                      <div class="alert alert-warning">
                          No hay datos de procesamiento disponibles aún.
                          Procesa algunas imágenes primero.
                      </div>
                  </div>
              </body>
              </html>
          `);
      }

      // ... resto del código del endpoint ...
  } catch (error) {
      console.error('Error al leer estadísticas:', error);
      res.status(500).send(`
          <html>
          <head>
              <title>Error</title>
              <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
          </head>
          <body>
              <div class="container mt-4">
                  <div class="alert alert-danger">
                      Error al obtener estadísticas: ${error.message}
                  </div>
              </div>
          </body>
          </html>
      `);
  }
});




// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

module.exports = app;