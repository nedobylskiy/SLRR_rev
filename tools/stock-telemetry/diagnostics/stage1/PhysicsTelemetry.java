package java.game;

// Diagnostic stage 1: enable only after stage 0 succeeds in the original game.
public class PhysicsTelemetry
{
    static int printed = 0;

    public static void sample(Vehicle car)
    {
        if(printed == 0)
        {
            printed = 1;
            System.log("SLRR_TELEMETRY_PROBE stage=1 hook=animate");
        }
    }

    public static void stop()
    {
        printed = 0;
    }
}
