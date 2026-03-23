# Agente Papales - Azure AI Foundry

Este proyecto es una interfaz web sencilla para interactuar con el agente inteligente **Papales**, configurado en Azure AI Foundry.

## 🚀 Requisitos previos

1.  **Node.js**: Asegúrate de tener instalado Node.js (v18 o superior).
2.  **Azure CLI**: Necesario para la autenticación por identidad.
    *   [Descargar Azure CLI](https://learn.microsoft.com/es-es/cli/azure/install-azure-cli)
3.  **Permisos en Azure**: Tu cuenta de Azure debe tener permisos de acceso al proyecto de AI Foundry especificado en el `.env`.

## 🛠️ Instalación y Uso

1.  **Instalar dependencias**:
    Abre una terminal en la carpeta del proyecto y ejecuta:
    ```bash
    npm install
    ```

2.  **Iniciar sesión en Azure**:
    Para que el servidor pueda conectar con los servicios de Azure de forma segura:
    ```bash
    az login
    ```

3.  **Iniciar el servidor**:
    ```bash
    node server.js
    ```

4.  **Abrir el Chat**:
    Ve a tu navegador y abre la siguiente dirección:
    `http://localhost:8080`

## ⚙️ Configuración (Archivo .env)

Si necesitas cambiar el agente o el proyecto de Azure, edita el archivo `.env`:

*   `AZURE_PROJECT_ENDPOINT`: La URL de tu proyecto en Azure.
*   `AZURE_AGENT_NAME`: El nombre del agente (ej. `papales`).
*   `AZURE_AGENT_VERSION`: Versión del agente (ej. `2`).
*   `AZURE_HOST` y `AZURE_IP`: Configuración para saltar bloqueos de red (Bypass DNS).

---
¡Disfruta chateando con Papales!
