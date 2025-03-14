# Image Processing Investigation Tool

## Requisitos del Sistema

| Software | Versión Mínima | Versión Recomendada |
|----------|----------------|---------------------|
| Node.js  | 18.0.0        | 22.14.0            |
| npm      | 8.0.0         | 10.9.2             |
| Python   | 3.8.0         | 3.13.2             |
| rembg    | 2.0.0         | 2.0.63             |

## Instalación

1. Clonar el repositorio:
```bash
git clone git@github.com:constantinokv/investigationMkt001.git
cd investigationMkt001
```

2. Instalar dependencias de Node.js:
```bash
npm install
```

3. Instalar rembg con soporte GPU:
```bash
pip install "rembg[gpu,cli]"
```

> **Nota importante**: La instalación de rembg debe hacerse por separado ya que es una dependencia de Python, no de Node.js. El comando `npm install` solo instalará las dependencias de JavaScript.

4. Verificar la instalación de rembg:
```bash
rembg --version
```

5. Crear directorios necesarios:
```bash
mkdir uploads processed
```

6. Iniciar el servidor:
```bash
npm start
```

7. Probar la aplicacion de preferencia con Brave (consume menos recursos):
```bash
localhost:3000
```

## Dependencias Principales

### Node.js (package.json)
- Express.js - Framework web
- Sharp - Procesamiento de imágenes
- Multer - Manejo de archivos
- Winston - Logging

### Python
- rembg[gpu,cli] - Eliminación de fondos con soporte GPU


 


## Monitoreo de GPU

Para monitorear el uso de GPU en tiempo real:
```bash
# Ver estado actual de la GPU
nvidia-smi

# Monitorear en tiempo real (actualización cada 1 segundo)
nvidia-smi -l 1
```

Este comando mostrará:
- Uso de GPU (%)
- Memoria utilizada
- Temperatura
- Procesos que están usando la GPU
