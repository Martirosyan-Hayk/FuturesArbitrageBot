#!/bin/bash

echo "🛑 Stopping Futures Arbitrage Bot (Local Development)"
echo "====================================================="

# Stop all services
echo "🔄 Stopping Docker Compose services..."
docker-compose down

# Show final status
echo ""
echo "📊 Final Status:"
echo "================"
docker-compose ps

echo ""
echo "✅ All services stopped!"
echo "💡 To start again, run: ./start-dev.sh" 