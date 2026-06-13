# kotlinx.serialization keeps generated serializers; the plugin adds the needed
# rules automatically. ChartMind builds JSON dynamically (no @Serializable model
# classes on the hot path), so no extra keep rules are required here.
