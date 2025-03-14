async function removeBackground() {
    if (!currentImage) return;
    
    try {
        showLoading();
        
        // Obtener el servicio seleccionado
        const selectedService = document.getElementById('bg-service').value;
        console.log('1. Servicio seleccionado:', selectedService);
       
        
        const formData = new FormData();
        
        // Convert data URL to File object
        const blob = await fetch(currentImage).then(r => r.blob());
        const file = new File([blob], "image.png", { type: "image/png" });
        formData.append('image', file);

        let endpoint = '/api/remove-background'; // Default para rembg
        let serviceName = 'Rembg';

     

        // Determinar el endpoint basado en la selección
        if (selectedService === 'azure') {
            console.log('2. Detectado servicio Azure');
            endpoint = '/api/remove-background-azure';
            serviceName = 'Azure Computer Vision';
        }

        console.log('3. Llamando a endpoint:', endpoint);
        
        // Llamar a la API
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        console.log('4. Respuesta recibida:', data);
        
        if (data.success) {
            const processedImageUrl = data.path;
            const absoluteUrl = window.location.origin + processedImageUrl;
            currentImage = absoluteUrl;
            previewImage.src = currentImage;
            
            // Agregar a historial
            imageHistory.push({
                label: `Sin Fondo (${serviceName})`,
                url: currentImage,
                timestamp: new Date().toISOString()
            });
            updateImageHistory();
            
            showNotification('Éxito', `Fondo removido correctamente usando ${serviceName}`);

            if (data.processTime) {
                console.log('5. Tiempo de procesamiento:', data.processTime);
                showNotification('Info', `Tiempo de procesamiento: ${data.processTime}`);
            }
        } else {
            throw new Error(data.error || 'Error al procesar la imagen');
        }
    } catch (error) {
        console.error('Error:', error);
        showNotification('Error', error.message, false);
    } finally {
        hideLoading();
    }
}