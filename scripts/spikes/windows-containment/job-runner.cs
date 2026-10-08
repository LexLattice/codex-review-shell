// Turn 6 spike helper, not production code.
//
// Runs one command line inside a fresh Job Object with KILL_ON_JOB_CLOSE and
// no breakaway, optionally at Low integrity. Because only this process holds
// the job handle, the whole process tree dies when this process dies for any
// reason (killed by the host, host crash through libuv's own job, or normal
// exit, after which the job is terminated explicitly).
//
// Usage: job-runner.exe [--integrity medium|low|low-read-only] --cmdline-b64 <base64 utf-8>
//        job-runner.exe --label-no-read-up <directory>
//
// Builds with the .NET Framework compiler present on every Windows 10/11:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /platform:x64 /out:job-runner.exe job-runner.cs
// The C# here stays at language version 5 for that compiler.

using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

static class JobRunner
{
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    const int STARTF_USESTDHANDLES = 0x00000100;
    const uint HANDLE_FLAG_INHERIT = 0x00000001;
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const uint INFINITE = 0xFFFFFFFF;
    const int TokenIntegrityLevel = 25;
    const uint TOKEN_DUPLICATE = 0x0002;
    const uint TOKEN_QUERY = 0x0008;
    const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    const uint MAXIMUM_ALLOWED = 0x02000000;
    const uint SE_GROUP_INTEGRITY = 0x00000020;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string app, StringBuilder cmdline, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr token, uint access, IntPtr attributes, int impersonationLevel, int tokenType, out IntPtr newToken);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertStringSidToSid(string sid, out IntPtr psid);
    [DllImport("advapi32.dll")]
    static extern int GetLengthSid(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool SetTokenInformation(IntPtr token, int infoClass, ref TOKEN_MANDATORY_LABEL info, int length);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr sd, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern uint SetNamedSecurityInfo(string name, int objectType, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);

    // Medium label with no-read-up and no-write-up, inherited by new children:
    // Low-integrity processes can neither read nor list the directory, while
    // the (Medium) host still can. icacls cannot set the no-read-up policy.
    static int LabelNoReadUp(string path)
    {
        IntPtr sd, sacl;
        uint size;
        bool present, defaulted;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NRNW;;;ME)", 1, out sd, out size)) Fail("ConvertStringSecurityDescriptorToSecurityDescriptor");
        if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted)) Fail("GetSecurityDescriptorSacl");
        // SE_FILE_OBJECT = 1, LABEL_SECURITY_INFORMATION = 0x10
        uint error = SetNamedSecurityInfo(path, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
        if (error != 0) Console.Error.WriteLine("job-runner: SetNamedSecurityInfo failed: " + new Win32Exception((int)error).Message);
        return error == 0 ? 0 : 125;
    }

    static void Fail(string what)
    {
        int code = Marshal.GetLastWin32Error();
        Console.Error.WriteLine("job-runner: " + what + " failed: " + new Win32Exception(code).Message + " (" + code + ")");
        Environment.Exit(125);
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool CreateRestrictedToken(IntPtr token, uint flags, uint disableSidCount, IntPtr sidsToDisable, uint deletePrivilegeCount, IntPtr privilegesToDelete, uint restrictedSidCount, SID_AND_ATTRIBUTES[] sidsToRestrict, out IntPtr newToken);

    const uint WRITE_RESTRICTED = 0x8;

    [StructLayout(LayoutKind.Sequential)]
    struct TOKEN_DEFAULT_DACL
    {
        public IntPtr DefaultDacl;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool ConvertSidToStringSid(IntPtr sid, out string sidString);
    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetSecurityDescriptorDacl(IntPtr sd, out bool present, out IntPtr dacl, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "SetTokenInformation")]
    static extern bool SetTokenInformationDacl(IntPtr token, int infoClass, ref TOKEN_DEFAULT_DACL info, int length);
    const uint SE_GROUP_LOGON_ID = 0xC0000000;

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool GetTokenInformation(IntPtr token, int infoClass, IntPtr buffer, int length, out int returned);

    static IntPtr LogonSid(IntPtr token)
    {
        int size;
        GetTokenInformation(token, 2 /* TokenGroups */, IntPtr.Zero, 0, out size);
        IntPtr buffer = Marshal.AllocHGlobal(size);
        if (!GetTokenInformation(token, 2, buffer, size, out size)) Fail("GetTokenInformation");
        int count = Marshal.ReadInt32(buffer);
        int entrySize = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
        // TOKEN_GROUPS: a DWORD count, then the array at pointer alignment.
        IntPtr entries = new IntPtr(buffer.ToInt64() + IntPtr.Size);
        for (int i = 0; i < count; i++)
        {
            SID_AND_ATTRIBUTES entry = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(new IntPtr(entries.ToInt64() + i * entrySize), typeof(SID_AND_ATTRIBUTES));
            if ((entry.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) return entry.Sid;
        }
        Console.Error.WriteLine("job-runner: no logon SID in token");
        Environment.Exit(125);
        return IntPtr.Zero;
    }

    // Read only: a write-restricted token whose only restricting SID is
    // Everyone, so a write needs an ACE granting Everyone write access, in
    // addition to passing the normal check. Unlike the Low label on a
    // workspace folder, this holds no matter how the folder is labeled.
    static IntPtr LowIntegrityToken(bool writeRestricted)
    {
        IntPtr self, low, sid;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_ASSIGN_PRIMARY, out self)) Fail("OpenProcessToken");
        if (writeRestricted)
        {
            IntPtr everyone;
            if (!ConvertStringSidToSid("S-1-1-0", out everyone)) Fail("ConvertStringSidToSid");
            // The logon SID keeps window station and desktop access; without it
            // processes fail DLL initialization (STATUS_DLL_INIT_FAILED).
            SID_AND_ATTRIBUTES[] restricting = new SID_AND_ATTRIBUTES[2];
            restricting[0].Sid = everyone;
            restricting[1].Sid = LogonSid(self);
            if (!CreateRestrictedToken(self, WRITE_RESTRICTED, 0, IntPtr.Zero, 0, IntPtr.Zero, 2, restricting, out low)) Fail("CreateRestrictedToken");
            // Objects the command creates (pipes, child processes) get the
            // token's default DACL, which grants only the user; the restricted
            // check then refuses writes to them. Grant the logon SID instead,
            // which passes both checks.
            string logon;
            if (!ConvertSidToStringSid(restricting[1].Sid, out logon)) Fail("ConvertSidToStringSid");
            IntPtr sd, dacl;
            uint sdSize;
            bool present, defaulted;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:(A;;GA;;;" + logon + ")(A;;GA;;;SY)", 1, out sd, out sdSize)) Fail("ConvertStringSecurityDescriptorToSecurityDescriptor");
            if (!GetSecurityDescriptorDacl(sd, out present, out dacl, out defaulted)) Fail("GetSecurityDescriptorDacl");
            TOKEN_DEFAULT_DACL defaultDacl = new TOKEN_DEFAULT_DACL();
            defaultDacl.DefaultDacl = dacl;
            if (!SetTokenInformationDacl(low, 6 /* TokenDefaultDacl */, ref defaultDacl, Marshal.SizeOf(typeof(TOKEN_DEFAULT_DACL)))) Fail("SetTokenInformation(TokenDefaultDacl)");
        }
        // SecurityImpersonation = 2, TokenPrimary = 1
        else if (!DuplicateTokenEx(self, MAXIMUM_ALLOWED, IntPtr.Zero, 2, 1, out low)) Fail("DuplicateTokenEx");
        if (!ConvertStringSidToSid("S-1-16-4096", out sid)) Fail("ConvertStringSidToSid");
        TOKEN_MANDATORY_LABEL label = new TOKEN_MANDATORY_LABEL();
        label.Label.Sid = sid;
        label.Label.Attributes = SE_GROUP_INTEGRITY;
        if (!SetTokenInformation(low, TokenIntegrityLevel, ref label, Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)) + GetLengthSid(sid))) Fail("SetTokenInformation");
        return low;
    }

    static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--label-no-read-up") return LabelNoReadUp(args[1]);
        string integrity = "medium";
        string cmdline = null;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--integrity" && i + 1 < args.Length) integrity = args[++i];
            else if (args[i] == "--cmdline-b64" && i + 1 < args.Length) cmdline = Encoding.UTF8.GetString(Convert.FromBase64String(args[++i]));
        }
        if (string.IsNullOrEmpty(cmdline))
        {
            Console.Error.WriteLine("job-runner: --cmdline-b64 is required");
            return 125;
        }

        // Not inheritable: a descendant holding the handle would keep the job alive.
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) Fail("CreateJobObject");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)))) Fail("SetInformationJobObject");

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);
        SetHandleInformation(si.hStdInput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(si.hStdOutput, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
        SetHandleInformation(si.hStdError, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);

        PROCESS_INFORMATION pi;
        StringBuilder line = new StringBuilder(cmdline);
        uint flags = CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT;
        bool lowered = integrity == "low" || integrity == "low-read-only";
        bool created = lowered
            ? CreateProcessAsUser(LowIntegrityToken(integrity == "low-read-only"), null, line, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi)
            : CreateProcess(null, line, IntPtr.Zero, IntPtr.Zero, true, flags, IntPtr.Zero, null, ref si, out pi);
        if (!created) Fail(lowered ? "CreateProcessAsUser" : "CreateProcess");
        if (!AssignProcessToJobObject(job, pi.hProcess))
        {
            TerminateProcess(pi.hProcess, 125);
            Fail("AssignProcessToJobObject");
        }
        ResumeThread(pi.hThread);
        WaitForSingleObject(pi.hProcess, INFINITE);
        uint exitCode;
        GetExitCodeProcess(pi.hProcess, out exitCode);
        // Like a Linux PID namespace: when the command exits, its leftovers go
        // too. (Exiting would close the job handle and do the same.)
        TerminateJobObject(job, exitCode);
        return (int)exitCode;
    }
}
